const path = require('path');
require('dotenv').config();

class ConfigManager {
  constructor() {
    this.supportedDialects = ['mysql', 'postgres', 'sqlite', 'mariadb', 'mssql'];
    this.defaultPorts = {
      mysql: 3306,
      mariadb: 3306,
      postgres: 5432,
      mssql: 1433,
      sqlite: null
    };
  }

  async load() {
    const config = this.loadFromEnvironment();
    await this.validate(config);
    return config;
  }

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
        console.warn('⚠️  Warning: No password specified (DB_PASSWORD)');
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

  printSummary(config) {
    console.log('📊 Database Configuration:');
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