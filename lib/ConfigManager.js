const path = require('path');
require('dotenv').config();

/**
 * Manages database configuration loading, validation, and processing.
 * Supports multiple database dialects including MySQL, PostgreSQL, SQLite, MariaDB, and MSSQL.
 */
class ConfigManager {
  /**
   * Creates a new ConfigManager instance with predefined supported dialects and default ports.
   */
  constructor() {
    /**
     * List of supported database dialects
     * @type {string[]}
     */
    this.supportedDialects = ['mysql', 'postgres', 'sqlite', 'mariadb', 'mssql'];
    
    /**
     * Default port numbers for each database dialect
     * @type {Object.<string, number|null>}
     */
    this.defaultPorts = {
      mysql: 3306,
      mariadb: 3306,
      postgres: 5432,
      mssql: 1433,
      sqlite: null
    };
  }

  /**
   * Loads and validates database configuration from environment variables.
   * 
   * @async
   * @returns {Promise<Object>} The validated database configuration object
   * @throws {Error} When configuration validation fails
   * 
   * @example
   * const configManager = new ConfigManager();
   * const config = await configManager.load();
   * console.log(config.database); // Database name from environment
   */
  async load() {
    const config = this.loadFromEnvironment();
    await this.validate(config);
    return config;
  }

  /**
   * Loads database configuration from environment variables.
   * 
   * @returns {Object} Database configuration object with the following properties:
   * @returns {string} returns.database - Database name
   * @returns {string} returns.username - Database username  
   * @returns {string} returns.password - Database password
   * @returns {string} returns.host - Database host
   * @returns {number|null} returns.port - Database port
   * @returns {string} returns.dialect - Database dialect
   * @returns {string} [returns.instanceName] - MSSQL instance name
   * @returns {boolean} returns.encrypt - MSSQL encryption setting
   * @returns {boolean} returns.trustServerCertificate - MSSQL certificate trust setting
   * @returns {boolean} returns.ssl - SSL connection setting (non-MSSQL)
   * @returns {string} returns.outputDir - Output directory path
   * @returns {string} [returns.storage] - SQLite storage path
   * 
   * @example
   * // Set environment variables first:
   * // DB_DIALECT=postgres
   * // DB_NAME=myapp
   * // DB_USER=admin
   * // DB_PASSWORD=secret
   * 
   * const config = configManager.loadFromEnvironment();
   * console.log(config.dialect); // 'postgres'
   */
  loadFromEnvironment() {
    const dialect = (process.env.DB_DIALECT || 'mysql').toLowerCase();
    
    const config = {
      // Basic connection
      database: process.env.DB_NAME || process.env.DB_DATABASE,
      username: process.env.DB_USER || process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : this.defaultPorts[dialect],
      dialect,
      
      // MSSQL specific options
      instanceName: process.env.DB_INSTANCE_NAME,
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
      
      // SSL options (not for MSSQL)
      ssl: process.env.DB_SSL === 'true',
      
      // Output configuration
      outputDir: process.env.OUTPUT_DIR || './output'
    };

    // For SQLite, use database name as storage path
    if (dialect === 'sqlite') {
      config.storage = config.database;
      // Default to a local SQLite file if not specified
      if (!config.database) {
        config.database = './database.sqlite';
        config.storage = './database.sqlite';
      }
    }

    return config;
  }

  /**
   * Validates the database configuration object.
   * Checks for required fields, valid dialect, proper port numbers, and dialect-specific requirements.
   * 
   * @async
   * @param {Object} config - The configuration object to validate
   * @param {string} config.dialect - Database dialect to validate
   * @param {string} [config.database] - Database name (required for non-SQLite)
   * @param {string} [config.username] - Database username (required for non-SQLite)
   * @param {string} [config.password] - Database password
   * @param {number|null} [config.port] - Database port number
   * @param {string} [config.storage] - SQLite storage path (required for SQLite)
   * @param {string} [config.instanceName] - MSSQL instance name
   * 
   * @returns {Promise<boolean>} Returns true if validation passes
   * @throws {Error} When validation fails with detailed error messages
   * 
   * @example
   * const config = { dialect: 'mysql', database: 'test', username: 'user' };
   * try {
   *   await configManager.validate(config);
   *   console.log('Configuration is valid');
   * } catch (error) {
   *   console.error('Validation failed:', error.message);
   * }
   */
  async validate(config) {
    const errors = [];

    // Check dialect
    if (!this.supportedDialects.includes(config.dialect)) {
      errors.push(`Unsupported database dialect: ${config.dialect}. Supported: ${this.supportedDialects.join(', ')}`);
    }

    // Check required fields based on dialect
    if (config.dialect !== 'sqlite') {
      if (!config.database) {
        errors.push('Database name is required (DB_NAME or DB_DATABASE)');
      }
      
      if (!config.username) {
        errors.push('Username is required (DB_USER or DB_USERNAME)');
      }
      
      // Password can be empty for some local setups
      if (config.password === undefined) {
        console.warn('âš ï¸  Warning: No password specified (DB_PASSWORD)');
      }
    } else {
      // SQLite specific validation
      if (!config.storage) {
        errors.push('SQLite database file path is required (DB_NAME)');
      }
    }

    // Port validation
    if (config.port !== null && (isNaN(config.port) || config.port < 1 || config.port > 65535)) {
      errors.push(`Invalid port number: ${config.port}`);
    }

    // MSSQL specific validation
    if (config.dialect === 'mssql') {
      if (config.instanceName && typeof config.instanceName !== 'string') {
        errors.push('Instance name must be a string');
      }
    }

    if (errors.length > 0) {
      throw new Error('Configuration validation failed:\n  - ' + errors.join('\n  - '));
    }

    return true;
  }

  /**
   * Converts the configuration object into Sequelize-compatible options.
   * Handles dialect-specific configurations and connection pooling settings.
   * 
   * @param {Object} config - The database configuration object
   * @param {string} config.host - Database host
   * @param {number|null} config.port - Database port
   * @param {string} config.dialect - Database dialect
   * @param {string} [config.storage] - SQLite storage path
   * @param {boolean} [config.encrypt] - MSSQL encryption setting
   * @param {boolean} [config.trustServerCertificate] - MSSQL certificate trust setting
   * @param {string} [config.instanceName] - MSSQL instance name
   * @param {boolean|Object} [config.ssl] - SSL configuration
   * 
   * @returns {Object} Sequelize options object with the following properties:
   * @returns {string} returns.host - Database host
   * @returns {number|null} returns.port - Database port
   * @returns {string} returns.dialect - Database dialect
   * @returns {boolean} returns.logging - Logging setting (always false)
   * @returns {Object} returns.dialectOptions - Dialect-specific options
   * @returns {Object} returns.pool - Connection pool configuration
   * @returns {string} [returns.storage] - SQLite storage path
   * 
   * @example
   * const config = { dialect: 'postgres', host: 'localhost', port: 5432, ssl: true };
   * const sequelizeOptions = configManager.getSequelizeOptions(config);
   * // Use with Sequelize: new Sequelize(database, username, password, sequelizeOptions)
   */
  getSequelizeOptions(config) {
    const options = {
      host: config.host,
      port: config.port,
      dialect: config.dialect,
      logging: false,
      dialectOptions: {},
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    };

    // Dialect-specific options
    switch (config.dialect) {
      case 'sqlite':
        options.storage = config.storage;
        break;
        
      case 'mssql':
        options.dialectOptions.options = {
          encrypt: config.encrypt,
          trustServerCertificate: config.trustServerCertificate,
          instanceName: config.instanceName || undefined,
          requestTimeout: 30000,
          connectionTimeout: 30000
        };
        break;
        
      case 'postgres':
        if (config.ssl) {
          options.dialectOptions.ssl = typeof config.ssl === 'boolean' ? { require: true } : config.ssl;
        }
        break;
        
      case 'mysql':
      case 'mariadb':
        if (config.ssl) {
          options.dialectOptions.ssl = config.ssl;
        }
        options.dialectOptions.charset = 'utf8mb4';
        break;
    }

    return options;
  }

  /**
   * Prints a formatted summary of the database configuration to the console.
   * Masks the password for security purposes.
   * 
   * @param {Object} config - The configuration object to summarize
   * @param {string} config.dialect - Database dialect
   * @param {string} config.database - Database name
   * @param {string} config.host - Database host
   * @param {number|null} config.port - Database port
   * @param {string} config.username - Database username
   * @param {string} [config.password] - Database password (will be masked)
   * @param {string} [config.instanceName] - MSSQL instance name
   * @param {string} config.outputDir - Output directory path
   * 
   * @example
   * const config = await configManager.load();
   * configManager.printSummary(config);
   * // Output:
   * // ðŸ"Š Database Configuration:
   * //    Dialect: MYSQL
   * //    Database: myapp
   * //    Host: localhost:3306
   * //    User: admin
   * //    Password: ***
   * //    Output: ./output
   */
  printSummary(config) {
    console.log('ðŸ"Š Database Configuration:');
    console.log(`   Dialect: ${config.dialect.toUpperCase()}`);
    console.log(`   Database: ${config.database}`);
    console.log(`   Host: ${config.host}:${config.port}`);
    console.log(`   User: ${config.username}`);
    console.log(`   Password: ${config.password ? '***' : 'not set'}`);
    
    if (config.dialect === 'mssql' && config.instanceName) {
      console.log(`   Instance: ${config.instanceName}`);
    }
    
    console.log(`   Output: ${config.outputDir}`);
  }
}

module.exports = { ConfigManager };