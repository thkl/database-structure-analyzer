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

class DatabaseAnalyzer {
  constructor(config) {
    this.config = config;
    this.sequelize = null;
    this.queryBuilder = null;
    this.tables = [];
    this.relationships = [];
    this.connectionTimer = null;
  }

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

  // Find the full name (with schema) of the referenced table
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

  // Normalize table names to handle different formats from different databases
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
        routingSpacingTop: parseInt(process.env.SVG_ROUTING_SPACING_TOP) || 120,
        routingSpacingSide: parseInt(process.env.SVG_ROUTING_SPACING_SIDE) || 40,
        maxColumns: parseInt(process.env.SVG_MAX_COLUMNS_TO_SHOW) || 40,
      };
      
      const generator = new SVGDiagramGenerator(this.tables, this.relationships, options);
      
      const filePath = await generator.generateToFile(outputDir);
      
      logger.success(`✅ SVG diagram generated: ${path.basename(filePath)} (${timer.elapsedFormatted()})`);
      
      if (options.debugPaths) {
        logger.info('🐛 Debug mode enabled - buffer zones and routing paths visible');
      }
      
      // Log current spacing configuration
      if (process.env.NODE_ENV === 'development') {
        logger.info(`📐 Spacing config: Canvas=${options.canvasMargin}px, Connection=${options.connectionMargin}px, Collision=${options.collisionBuffer}px, Visual=${options.visualBuffer}px`);
      }
      
    } catch (error) {
      throw new Error(`Failed to generate SVG diagram: ${error.message}`);
    }
  }

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