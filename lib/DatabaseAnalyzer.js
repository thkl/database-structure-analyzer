const { Sequelize } = require('sequelize');
const { QueryBuilder } = require('./QueryBuilder');
const { SVGDiagramGenerator } = require('./SVGDiagramGenerator');
const { 
  logger, 
  validateDatabaseStructure, 
  writeFileWithBackup, 
  escapeIdentifier,
  Timer 
} = require('./utils');
const path = require('path');

/**
 * Analyzes database structure, relationships, and generates documentation.
 * Supports multiple database dialects and provides comprehensive analysis capabilities.
 * 
 * @class DatabaseAnalyzer
 * @example
 * const config = { dialect: 'mysql', database: 'mydb', username: 'user', password: 'pass' };
 * const analyzer = new DatabaseAnalyzer(config);
 * await analyzer.validateConnection();
 * const structure = await analyzer.analyzeStructure();
 * await analyzer.generateSQLFiles('./output');
 * await analyzer.close();
 */
class DatabaseAnalyzer {
  /**
   * Creates a new DatabaseAnalyzer instance.
   * 
   * @param {Object} config - Database configuration object
   * @param {string} config.dialect - Database dialect (mysql, postgres, sqlite, mariadb, mssql)
   * @param {string} config.database - Database name
   * @param {string} [config.username] - Database username (not required for SQLite)
   * @param {string} [config.password] - Database password (not required for SQLite)
   * @param {string} [config.host='localhost'] - Database host
   * @param {number} [config.port] - Database port (uses dialect defaults if not specified)
   * @param {string} [config.storage] - SQLite file path (SQLite only)
   * 
   * @example
   * const config = {
   *   dialect: 'postgres',
   *   database: 'myapp',
   *   username: 'admin',
   *   password: 'secret',
   *   host: 'localhost',
   *   port: 5432
   * };
   * const analyzer = new DatabaseAnalyzer(config);
   */
  constructor(config) {
    /**
     * Database configuration object
     * @type {Object}
     */
    this.config = config;
    
    /**
     * Sequelize instance for database operations
     * @type {Sequelize|null}
     */
    this.sequelize = null;
    
    /**
     * Query builder instance for dialect-specific queries
     * @type {QueryBuilder|null}
     */
    this.queryBuilder = null;
    
    /**
     * Array of analyzed table objects
     * @type {Object[]}
     */
    this.tables = [];
    
    /**
     * Array of discovered relationships between tables
     * @type {Object[]}
     */
    this.relationships = [];
    
    /**
     * Timer for tracking connection validation performance
     * @type {Timer|null}
     */
    this.connectionTimer = null;
  }

  /**
   * Validates database connection and access permissions.
   * Tests basic connectivity and database access rights.
   * 
   * @async
   * @returns {Promise<boolean>} Returns true if validation succeeds
   * @throws {Error} When connection validation fails with specific error details
   * 
   * @example
   * try {
   *   await analyzer.validateConnection();
   *   console.log('Database connection is valid');
   * } catch (error) {
   *   console.error('Connection failed:', error.message);
   * }
   */
  async validateConnection() {
    this.connectionTimer = new Timer();
    
    try {
      // Initialize Sequelize connection
      await this.connect();
      
      // Test basic database access
      await this.testDatabaseAccess();
      
      logger.success(`✅ Database connection validated (${this.connectionTimer.elapsedFormatted()})`);
      return true;
      
    } catch (error) {
      logger.error(`❌ Connection validation failed: ${error.message}`);
      
      // Provide specific guidance based on error type
      if (error.name === 'SequelizeConnectionError') {
        throw new Error(`Database connection failed: ${error.message}\n` +
          'Please check your connection settings in .env file');
      } else if (error.name === 'SequelizeAccessDeniedError') {
        throw new Error(`Access denied: ${error.message}\n` +
          'Please verify username, password, and user permissions');
      } else if (error.name === 'SequelizeHostNotFoundError') {
        throw new Error(`Host not found: ${error.message}\n` +
          'Please verify the database server hostname and port');
      }
      
      throw error;
    }
  }

  /**
   * Establishes database connection using Sequelize.
   * Initializes the Sequelize instance and QueryBuilder with appropriate options.
   * 
   * @async
   * @private
   * @throws {Error} When connection establishment fails
   * 
   * @example
   * await analyzer.connect(); // Internal method called by validateConnection()
   */
  async connect() {
    const { ConfigManager } = require('./ConfigManager');
    const configManager = new ConfigManager();
    const options = configManager.getSequelizeOptions(this.config);

    if (this.config.dialect === 'sqlite') {
      this.sequelize = new Sequelize(options);
    } else {
      this.sequelize = new Sequelize(
        this.config.database,
        this.config.username,
        this.config.password,
        options
      );
    }

    this.queryBuilder = new QueryBuilder(this.config.dialect, this.config.database);

    // Test the connection
    await this.sequelize.authenticate();
  }

  /**
   * Tests database access permissions and verifies connectivity.
   * Performs various checks including database name verification, table access, and permissions.
   * 
   * @async
   * @private
   * @throws {Error} When database access tests fail
   * 
   * @example
   * await analyzer.testDatabaseAccess(); // Internal method called during validation
   */
  async testDatabaseAccess() {
    try {
      // Verify we can access the correct database
      const currentDbQuery = this.queryBuilder.getCurrentDatabaseQuery();
      if (currentDbQuery) {
        const [results] = await this.sequelize.query(currentDbQuery);
        const currentDb = results[0]?.current_db;
        
        if (this.config.dialect !== 'sqlite' && currentDb !== this.config.database) {
          throw new Error(`Connected to wrong database: expected '${this.config.database}', got '${currentDb}'`);
        }
      }

      // Test if we can access table information
      const accessTestQuery = this.queryBuilder.getDatabaseAccessTestQuery();
      if (accessTestQuery) {
        const [results] = await this.sequelize.query(accessTestQuery);
        const tableCount = results[0]?.table_count;
        
        if (tableCount === undefined || tableCount === null) {
          throw new Error('Unable to query database metadata. Check user permissions.');
        }
        
        logger.info(`📊 Database contains ${tableCount} tables`);
      }

      // For SQLite, verify file exists and is readable
      if (this.config.dialect === 'sqlite') {
        try {
          await this.sequelize.query('SELECT name FROM sqlite_master WHERE type="table" LIMIT 1');
        } catch (error) {
          throw new Error(`SQLite database file not accessible: ${error.message}`);
        }
      }

    } catch (error) {
      if (error.message.includes('Unknown database')) {
        throw new Error(`Database '${this.config.database}' does not exist on server '${this.config.host}'`);
      } else if (error.message.includes('Access denied for user')) {
        throw new Error(`User '${this.config.username}' does not have access to database '${this.config.database}'`);
      } else if (error.message.includes('permission denied')) {
        throw new Error(`Permission denied accessing database '${this.config.database}'. Check user privileges.`);
      }
      
      throw error;
    }
  }

  /**
   * Analyzes the complete database structure including tables, columns, and relationships.
   * Discovers all tables, analyzes their structure, and maps relationships between them.
   * 
   * @async
   * @returns {Promise<Object>} Database structure object with tables and relationships
   * @returns {Object[]} returns.tables - Array of table objects with full metadata
   * @returns {Object[]} returns.relationships - Array of relationship objects between tables
   * @throws {Error} When structure analysis fails
   * 
   * @example
   * const structure = await analyzer.analyzeStructure();
   * console.log(`Found ${structure.tables.length} tables and ${structure.relationships.length} relationships`);
   * 
   * // Access table details
   * structure.tables.forEach(table => {
   *   console.log(`Table: ${table.name} with ${table.columns.length} columns`);
   * });
   */
  async analyzeStructure() {
    const timer = new Timer();
    
    try {
      const queryInterface = this.sequelize.getQueryInterface();
      
      // Get all table names
      logger.info('🔍 Discovering tables...');
      const rawTableNames = await queryInterface.showAllTables();
      
      // Handle different formats: MSSQL returns objects, others return strings
      const tableNames = this.normalizeTableNames(rawTableNames);
      
      if (tableNames.length === 0) {
        logger.warn('⚠️  No tables found in database');
        return {
          tables: [],
          relationships: []
        };
      }

      logger.info(`📋 Found ${tableNames.length} tables`);
      
      // Show schemas if they exist
      if (this.config.dialect === 'mssql') {
        const schemas = new Set(tableNames.map(t => t.schema).filter(Boolean));
        if (schemas.size > 0) {
          logger.info(`   📂 Schemas: ${Array.from(schemas).join(', ')}`);
        }
      }

      // Analyze each table with progress
      let processedTables = 0;
      for (const tableInfo of tableNames) {
        try {
          const tableData = await this.analyzeTable(tableInfo);
          this.tables.push(tableData);
          processedTables++;
          
          if (processedTables % 5 === 0 || processedTables === tableNames.length) {
            logger.info(`   📊 Processed ${processedTables}/${tableNames.length} tables`);
          }
        } catch (error) {
          const tableName = typeof tableInfo === 'string' ? tableInfo : `${tableInfo.schema}.${tableInfo.tableName}`;
          logger.warn(`⚠️  Failed to analyze table '${tableName}': ${error.message}`);
        }
      }

      // Analyze relationships
      logger.info('🔗 Analyzing relationships...');
      await this.analyzeRelationships();

      const structure = {
        tables: this.tables,
        relationships: this.relationships
      };

      // Validate the structure
      const validationErrors = validateDatabaseStructure(structure);
      if (validationErrors.length > 0) {
        logger.warn('⚠️  Structure validation warnings:');
        validationErrors.forEach(error => logger.warn(`   - ${error}`));
      }

      logger.success(`✅ Analysis completed in ${timer.elapsedFormatted()}`);
      return structure;
      
    } catch (error) {
      logger.error(`❌ Structure analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyzes a single table's structure including columns, indexes, and constraints.
   * 
   * @async
   * @param {Object} tableInfo - Table information object
   * @param {string} tableInfo.name - Table name
   * @param {string} [tableInfo.schema] - Table schema (for MSSQL)
   * @param {string} tableInfo.fullName - Full qualified table name
   * @returns {Promise<Object>} Complete table analysis object
   * @returns {string} returns.name - Table name
   * @returns {string} returns.schema - Table schema
   * @returns {string} returns.fullName - Full qualified name
   * @returns {string} returns.displayName - Display name for output
   * @returns {Object[]} returns.columns - Array of column objects
   * @returns {Object[]} returns.indexes - Array of index objects
   * @returns {string[]} returns.primaryKeys - Array of primary key column names
   * @returns {Object[]} returns.foreignKeys - Array of foreign key objects
   * @returns {Object|null} returns.stats - Optional table statistics
   * @throws {Error} When table analysis fails
   * 
   * @example
   * const tableInfo = { name: 'users', schema: 'dbo', fullName: 'dbo.users' };
   * const tableData = await analyzer.analyzeTable(tableInfo);
   * console.log(`Table ${tableData.name} has ${tableData.columns.length} columns`);
   */
  async analyzeTable(tableInfo) {
    const queryInterface = this.sequelize.getQueryInterface();
    const tableName = tableInfo.name;
    const tableSchema = tableInfo.schema;
    const fullTableName = tableInfo.fullName;
    
    try {
      // Get column information
      const columns = await queryInterface.describeTable(tableName);
      
      // Get indexes (with error handling for unsupported databases)
      let indexes = [];
      try {
        indexes = await queryInterface.showIndex(tableName);
      } catch (error) {
        logger.warn(`⚠️  Could not get indexes for ${fullTableName}: ${error.message}`);
      }

      const tableData = {
        name: tableName,
        schema: tableSchema,
        fullName: fullTableName,
        displayName: fullTableName, // Used for output and diagrams
        columns: Object.keys(columns).map(columnName => ({
          name: columnName,
          type: columns[columnName].type,
          allowNull: columns[columnName].allowNull !== false,
          defaultValue: columns[columnName].defaultValue,
          primaryKey: columns[columnName].primaryKey || false,
          autoIncrement: columns[columnName].autoIncrement || false,
          unique: columns[columnName].unique || false
        })),
        indexes: indexes.map(index => ({
          name: index.name,
          unique: index.unique,
          primary: index.primary,
          fields: index.fields ? index.fields.map(field => field.attribute) : []
        })),
        primaryKeys: [],
        foreignKeys: [],
        stats: null
      };

      // Extract primary keys
      tableData.primaryKeys = tableData.columns
        .filter(col => col.primaryKey)
        .map(col => col.name);

      // Get foreign key constraints
      try {
        const foreignKeys = await this.getForeignKeys(tableInfo);
        tableData.foreignKeys = foreignKeys;
      } catch (error) {
        logger.warn(`⚠️  Could not get foreign keys for ${fullTableName}: ${error.message}`);
      }

      // Get additional table statistics (optional)
      try {
        const stats = await this.getTableStats(tableInfo);
        tableData.stats = stats;
      } catch (error) {
        // Stats are optional, don't warn unless in debug mode
        if (process.env.NODE_ENV === 'development') {
          logger.warn(`⚠️  Could not get stats for ${fullTableName}: ${error.message}`);
        }
      }

      return tableData;
      
    } catch (error) {
      throw new Error(`Failed to analyze table '${fullTableName}': ${error.message}`);
    }
  }

  /**
   * Retrieves foreign key constraints for a specific table.
   * Uses dialect-specific queries to discover foreign key relationships.
   * 
   * @async
   * @param {Object} tableInfo - Table information object
   * @param {string} tableInfo.name - Table name
   * @param {string} [tableInfo.schema] - Table schema
   * @returns {Promise<Object[]>} Array of foreign key objects
   * @returns {string} returns[].column - Column name with foreign key
   * @returns {string} returns[].referencedTable - Referenced table name
   * @returns {string} returns[].referencedColumn - Referenced column name
   * @returns {string} returns[].constraintName - Constraint name
   * @returns {string} [returns[].referencedSchema] - Referenced table schema
   * 
   * @example
   * const tableInfo = { name: 'orders', schema: 'dbo' };
   * const foreignKeys = await analyzer.getForeignKeys(tableInfo);
   * foreignKeys.forEach(fk => {
   *   console.log(`${fk.column} references ${fk.referencedTable}.${fk.referencedColumn}`);
   * });
   */
  async getForeignKeys(tableInfo) {
    const query = this.queryBuilder.getForeignKeysQuery(tableInfo.name, tableInfo.schema);
    
    if (!query) {
      return [];
    }

    try {
      // Special handling for SQLite PRAGMA
      if (this.config.dialect === 'sqlite') {
        const [results] = await this.sequelize.query(query);
        return results.map(row => ({
          column: row.from,
          referencedTable: row.table,
          referencedColumn: row.to,
          constraintName: `fk_${tableInfo.name}_${row.from}`
        }));
      }

      const [results] = await this.sequelize.query(query);
      return results.map(row => ({
        column: row.column_name,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
        constraintName: row.constraint_name,
        referencedSchema: row.referenced_schema || null
      }));
    } catch (error) {
      logger.warn(`Could not retrieve foreign keys for ${tableInfo.fullName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieves additional statistics for a table (row count, size, etc.).
   * Statistics collection is optional and will not fail the analysis if unavailable.
   * 
   * @async
   * @param {Object} tableInfo - Table information object
   * @param {string} tableInfo.name - Table name
   * @param {string} [tableInfo.schema] - Table schema
   * @returns {Promise<Object|null>} Table statistics object or null if unavailable
   * 
   * @example
   * const stats = await analyzer.getTableStats(tableInfo);
   * if (stats) {
   *   console.log(`Table has ${stats.table_rows} rows`);
   * }
   */
  async getTableStats(tableInfo) {
    const query = this.queryBuilder.getTableInfoQuery(tableInfo.name, tableInfo.schema);
    
    if (!query) {
      return null;
    }

    try {
      const [results] = await this.sequelize.query(query);
      return results[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyzes relationships between tables based on foreign key constraints.
   * Discovers and categorizes relationships (one-to-one, many-to-one, etc.).
   * 
   * @async
   * @private
   * 
   * @example
   * await analyzer.analyzeRelationships(); // Called internally during analyzeStructure()
   * console.log(`Found ${analyzer.relationships.length} relationships`);
   */
  async analyzeRelationships() {
    const relationshipMap = new Map();
    
    for (const table of this.tables) {
      for (const fk of table.foreignKeys) {
        // Handle schema-qualified referenced table names
        const referencedTable = this.findReferencedTable(fk.referencedTable, fk.referencedSchema);
        const key = `${table.fullName}.${fk.column}->${referencedTable}.${fk.referencedColumn}`;
        
        if (!relationshipMap.has(key)) {
          const relationship = {
            fromTable: table.fullName,
            fromColumn: fk.column,
            toTable: referencedTable,
            toColumn: fk.referencedColumn,
            constraintName: fk.constraintName,
            type: this.determineRelationshipType(table, fk)
          };
          
          relationshipMap.set(key, relationship);
          this.relationships.push(relationship);
        }
      }
    }

    logger.info(`   🔗 Found ${this.relationships.length} relationships`);
  }

  /**
   * Finds the full name (with schema) of a referenced table.
   * Handles schema qualification and fallback logic for cross-schema references.
   * 
   * @param {string} tableName - Table name to find
   * @param {string} [schema] - Schema name (optional)
   * @returns {string} Full qualified table name
   * 
   * @example
   * const fullName = analyzer.findReferencedTable('users', 'auth');
   * console.log(fullName); // 'auth.users' or 'users' depending on schema handling
   */
  findReferencedTable(tableName, schema) {
    // First try to find by exact full name match
    const exactMatch = this.tables.find(t => 
      t.name === tableName && t.schema === schema
    );
    
    if (exactMatch) {
      return exactMatch.fullName;
    }
    
    // Fallback: try to find by table name only
    const nameMatch = this.tables.find(t => t.name === tableName);
    if (nameMatch) {
      return nameMatch.fullName;
    }
    
    // If not found in our analyzed tables, construct the name
    if (this.config.dialect === 'mssql' && schema) {
      return `${schema}.${tableName}`;
    }
    
    return tableName;
  }

  /**
   * Determines the type of relationship between tables based on foreign key constraints.
   * Uses heuristics to classify relationships as one-to-one, one-to-many, etc.
   * 
   * @param {Object} table - Source table object
   * @param {Object} foreignKey - Foreign key constraint object
   * @returns {string} Relationship type ('one-to-one', 'many-to-one', 'unknown')
   * 
   * @example
   * const relationshipType = analyzer.determineRelationshipType(orderTable, customerForeignKey);
   * console.log(relationshipType); // 'many-to-one'
   */
  determineRelationshipType(table, foreignKey) {
    // Simple heuristic - could be enhanced with more sophisticated analysis
    const toTable = this.tables.find(t => 
      t.name === foreignKey.referencedTable || 
      t.fullName === this.findReferencedTable(foreignKey.referencedTable, foreignKey.referencedSchema)
    );
    
    if (!toTable) {
      return 'unknown';
    }

    // Check if the foreign key column is also a primary key (potential one-to-one)
    if (table.primaryKeys.includes(foreignKey.column)) {
      return 'one-to-one';
    }

    return 'many-to-one';
  }

  /**
   * Normalizes table names to handle different formats from different databases.
   * MSSQL returns objects with schema information, others return simple strings.
   * 
   * @param {(string[]|Object[])} rawTableNames - Raw table names from database
   * @returns {Object[]} Normalized table information objects
   * @returns {string} returns[].name - Table name
   * @returns {string|null} returns[].schema - Schema name (null for non-schema databases)
   * @returns {string} returns[].fullName - Full qualified name
   * 
   * @example
   * // For MSSQL: [{ tableName: 'users', schema: 'dbo' }]
   * // For MySQL: ['users', 'orders']
   * const normalized = analyzer.normalizeTableNames(rawTableNames);
   * console.log(normalized[0].fullName); // 'dbo.users' or 'users'
   */
  normalizeTableNames(rawTableNames) {
    if (this.config.dialect === 'mssql') {
      // MSSQL returns objects with tableName and schema
      return rawTableNames.map(item => {
        if (typeof item === 'object' && item.tableName) {
          return {
            name: item.tableName,
            schema: item.schema || 'dbo',
            fullName: `${item.schema || 'dbo'}.${item.tableName}`
          };
        }
        // Fallback if format is unexpected
        return {
          name: item,
          schema: 'dbo',
          fullName: `dbo.${item}`
        };
      });
    } else {
      // Other databases return simple strings
      return rawTableNames.map(tableName => ({
        name: tableName,
        schema: null,
        fullName: tableName
      }));
    }
  }

  /**
   * Generates SQL files containing CREATE TABLE statements from the analyzed structure.
   * Creates a complete SQL script that can recreate the database structure.
   * 
   * @async
   * @param {string} outputDir - Directory path where SQL files will be saved
   * @throws {Error} When SQL file generation fails
   * 
   * @example
   * await analyzer.generateSQLFiles('./output');
   * // Creates: ./output/create_tables.sql
   */
  async generateSQLFiles(outputDir) {
    const timer = new Timer();
    
    try {
      logger.info('📄 Generating SQL files...');
      
      const createTableSQL = this.generateCreateTableSQL();
      const filePath = path.join(outputDir, 'create_tables.sql');
      await writeFileWithBackup(filePath, createTableSQL);
      
      logger.success(`✅ SQL file generated: ${path.basename(filePath)} (${timer.elapsedFormatted()})`);
      
    } catch (error) {
      throw new Error(`Failed to generate SQL files: ${error.message}`);
    }
  }

  /**
   * Generates complete CREATE TABLE SQL statements for all analyzed tables.
   * Includes table creation, primary keys, and foreign key constraints.
   * 
   * @returns {string} Complete SQL script with CREATE TABLE statements
   * 
   * @example
   * const sql = analyzer.generateCreateTableSQL();
   * console.log(sql); // Complete SQL script
   */
  generateCreateTableSQL() {
    let sql = '-- Database Structure Export\n';
    sql += `-- Generated on ${new Date().toISOString()}\n`;
    sql += `-- Database: ${this.config.database} (${this.config.dialect})\n`;
    sql += `-- Tables: ${this.tables.length}, Relationships: ${this.relationships.length}\n\n`;

    for (const table of this.tables) {
      sql += this.generateTableSQL(table);
      sql += '\n';
    }

    return sql;
  }

  /**
   * Generates CREATE TABLE SQL statement for a specific table.
   * Handles dialect-specific syntax and includes constraints and foreign keys.
   * 
   * @param {Object} table - Table object to generate SQL for
   * @param {string} table.name - Table name
   * @param {string} [table.schema] - Table schema
   * @param {Object[]} table.columns - Array of column objects
   * @param {string[]} table.primaryKeys - Primary key column names
   * @param {Object[]} table.foreignKeys - Foreign key constraints
   * @param {Object} [table.stats] - Optional table statistics
   * @returns {string} SQL CREATE TABLE statement with constraints
   * 
   * @example
   * const sql = analyzer.generateTableSQL(tableObject);
   * console.log(sql); // CREATE TABLE statement with constraints
   */
  generateTableSQL(table) {
    const dialect = this.config.dialect;
    const tableName = dialect === 'mssql' && table.schema
      ? `[${table.schema}].[${table.name}]`
      : escapeIdentifier(table.name, dialect);
    
    let sql = `-- Table: ${table.displayName}\n`;
    if (table.stats && table.stats.table_comment) {
      sql += `-- ${table.stats.table_comment}\n`;
    }
    
    sql += `CREATE TABLE ${tableName} (\n`;

    const columnDefinitions = table.columns.map(col => {
      const colName = escapeIdentifier(col.name, dialect);
      let def = `  ${colName} ${col.type}`;
      
      if (!col.allowNull) def += ' NOT NULL';
      
      if (col.autoIncrement) {
        if (dialect === 'mssql') {
          def += ' IDENTITY(1,1)';
        } else if (dialect === 'postgres') {
          def += ' GENERATED ALWAYS AS IDENTITY';
        } else {
          def += ' AUTO_INCREMENT';
        }
      }
      
      if (col.defaultValue !== null && col.defaultValue !== undefined) {
        def += ` DEFAULT ${col.defaultValue}`;
      }
      
      return def;
    });

    sql += columnDefinitions.join(',\n');

    // Add primary key constraint
    if (table.primaryKeys.length > 0) {
      const pkColumns = table.primaryKeys
        .map(pk => escapeIdentifier(pk, dialect))
        .join(', ');
      sql += `,\n  PRIMARY KEY (${pkColumns})`;
    }

    sql += '\n);\n\n';

    // Add foreign key constraints
    for (const fk of table.foreignKeys) {
      const constraintName = escapeIdentifier(fk.constraintName || `fk_${table.name}_${fk.column}`, dialect);
      const fkColumn = escapeIdentifier(fk.column, dialect);
      
      // Handle schema-qualified referenced table names
      let refTable;
      if (dialect === 'mssql' && fk.referencedSchema) {
        refTable = `[${fk.referencedSchema}].[${fk.referencedTable}]`;
      } else {
        refTable = escapeIdentifier(fk.referencedTable, dialect);
      }
      
      const refColumn = escapeIdentifier(fk.referencedColumn, dialect);
      
      sql += `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} `;
      sql += `FOREIGN KEY (${fkColumn}) REFERENCES ${refTable}(${refColumn});\n`;
    }

    return sql;
  }

  /**
   * Generates SVG entity relationship diagram from the analyzed database structure.
   * Creates a visual representation of tables and their relationships.
   * 
   * @async
   * @param {string} outputDir - Directory path where SVG file will be saved
   * @throws {Error} When SVG diagram generation fails
   * 
   * @example
   * await analyzer.generateSVGDiagram('./output');
   * // Creates: ./output/database_diagram.svg
   * 
   * @example
   * // Configure via environment variables:
   * process.env.SVG_CANVAS_MARGIN = '150';
   * process.env.DEBUG_PATHS = 'true';
   * await analyzer.generateSVGDiagram('./output');
   */
  async generateSVGDiagram(outputDir) {
    const timer = new Timer();
    
    try {
      logger.info('🎨 Generating SVG diagram...');
      
      const options = {
        colorScheme: 'modern',
        showDataTypes: true,
        showConstraints: true,
        debugPaths: process.env.DEBUG_PATHS === 'true', // Enable debug mode via environment variable
        
        // Configurable spacing and margins - adjust these for different layouts
        canvasMargin: parseInt(process.env.SVG_CANVAS_MARGIN) || 100,
        connectionMargin: parseInt(process.env.SVG_CONNECTION_MARGIN) || 25,
        collisionBuffer: parseInt(process.env.SVG_COLLISION_BUFFER) || 25,
        visualBuffer: parseInt(process.env.SVG_VISUAL_BUFFER) || 50,
        safeZoneOffset: parseInt(process.env.SVG_SAFE_ZONE_OFFSET) || 40,
        routingSpacingTop: parseInt(process.env.SVG_ROUTING_SPACING_TOP) || 60,
        routingSpacingSide: parseInt(process.env.SVG_ROUTING_SPACING_SIDE) || 40,
        maxColumns:parseInt(process.env.SVG_MAX_COLUMNS_TO_SHOW) || 40,
      };
      
      const generator = new SVGDiagramGenerator(this.tables, this.relationships, options);
      
      const filePath = await generator.generateToFile(outputDir);
      
      logger.success(`✅ SVG diagram generated: ${path.basename(filePath)} (${timer.elapsedFormatted()})`);
      
      if (options.debugPaths) {
        logger.info('🐛 Debug mode enabled - buffer zones and routing paths visible');
      }
      
      // Log current spacing configuration
      if (process.env.NODE_ENV === 'development') {
        logger.info(`🔧 Spacing config: Canvas=${options.canvasMargin}px, Connection=${options.connectionMargin}px, Collision=${options.collisionBuffer}px, Visual=${options.visualBuffer}px`);
      }
      
    } catch (error) {
      throw new Error(`Failed to generate SVG diagram: ${error.message}`);
    }
  }

  /**
   * Closes the database connection and cleans up resources.
   * Should be called when analysis is complete to prevent connection leaks.
   * 
   * @async
   * 
   * @example
   * await analyzer.close();
   * console.log('Database connection closed');
   */
  async close() {
    if (this.sequelize) {
      try {
        await this.sequelize.close();
        logger.info('🔌 Database connection closed');
      } catch (error) {
        logger.warn(`⚠️  Error closing connection: ${error.message}`);
      }
    }
  }
}

module.exports = { DatabaseAnalyzer };