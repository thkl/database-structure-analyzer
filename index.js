#!/usr/bin/env node

const { ConfigManager } = require('./lib/ConfigManager');
const { DatabaseAnalyzer } = require('./lib/DatabaseAnalyzer');
const { SequelizeModelAnalyzer } = require('./lib/SequelizeModelAnalyzer');
const { logger } = require('./lib/utils');

async function main() {
  try {
    // Check if we should analyze database or existing models
    const mode = process.env.ANALYSIS_MODE || 'database'; // 'database' or 'models'
    
    if (mode === 'models') {
      await analyzeSequelizeModels();
    } else {
      await analyzeDatabaseConnection();
    }

  } catch (error) {
    logger.error('❌ Error:', error.message);
    
    if (process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Analyze database via connection
async function analyzeDatabaseConnection() {
  // Load and validate configuration
  const configManager = new ConfigManager();
  const config = await configManager.load();
  
  logger.info('🚀 Starting Database Structure Analyzer...');
  logger.info(`📊 Target: ${config.dialect.toUpperCase()} database "${config.database}" at ${config.host}:${config.port}`);

  const analyzer = new DatabaseAnalyzer(config);

  try {
    // Test connection and database access
    await analyzer.validateConnection();
    
    // Analyze structure
    logger.info('🔍 Analyzing database structure...');
    const structure = await analyzer.analyzeStructure();

    // Validate results
    if (structure.tables.length === 0) {
      throw new Error('No tables found in database. This could mean:\n' +
        '  - Database is empty\n' +
        '  - User lacks sufficient permissions\n' +
        '  - Database name is incorrect\n' +
        '  - Schema/catalog permissions issue');
    }

    logger.success(`📋 Analysis complete:`);
    logger.info(`   - Tables: ${structure.tables.length}`);
    logger.info(`   - Relationships: ${structure.relationships.length}`);

    // Show table summary
    if (structure.tables.length > 0) {
      logger.info('📑 Tables found:');
      structure.tables.forEach(table => {
        const pkCount = table.primaryKeys.length;
        const fkCount = table.foreignKeys.length;
        const displayName = table.displayName || table.fullName || table.name;
        logger.info(`   - ${displayName} (${table.columns.length} columns, ${pkCount} PK, ${fkCount} FK)`);
      });
    }

    // Generate outputs
    const outputDir = process.env.OUTPUT_DIR || './output';
    await analyzer.generateSQLFiles(outputDir);
    await analyzer.generateSVGDiagram(outputDir);

    logger.success('✅ All files generated successfully!');
    logger.info(`📁 Output directory: ${outputDir}`);
    logger.info(`   - create_tables.sql`);
    logger.info(`   - database_diagram.svg`);

  } catch (error) {
    await analyzer.close();
    throw error;
  }

  await analyzer.close();
}

// Analyze existing Sequelize models
async function analyzeSequelizeModels() {
  logger.info('🚀 Starting Sequelize Model Analyzer...');
  
  // Import the user's Sequelize instance
  let sequelize;
  try {
    // Try to require the Sequelize instance from common locations
    const modelPaths = [
      './models/index.js',
      './models',
      './src/models/index.js',
      './src/models',
      './db/models/index.js',
      './database/models/index.js',
      process.env.SEQUELIZE_MODELS_PATH || './models'
    ];

    for (const modelPath of modelPaths) {
      try {
        const models = require(modelPath);
        if (models.sequelize) {
          sequelize = models.sequelize;
          logger.info(`📦 Found Sequelize instance at: ${modelPath}`);
          break;
        } else if (models.default && models.default.sequelize) {
          sequelize = models.default.sequelize;
          logger.info(`📦 Found Sequelize instance (default export) at: ${modelPath}`);
          break;
        }
      } catch (err) {
        // Try next path
        continue;
      }
    }

    if (!sequelize) {
      throw new Error('Could not find Sequelize instance. Please ensure:\n' +
        '  - Your models/index.js exports a sequelize instance\n' +
        '  - Or set SEQUELIZE_MODELS_PATH environment variable\n' +
        '  - Or place this tool in your project root directory');
    }

  } catch (error) {
    throw new Error(`Failed to load Sequelize models: ${error.message}\n\n` +
      'To analyze existing Sequelize models:\n' +
      '1. Place this tool in your project root directory, OR\n' +
      '2. Set SEQUELIZE_MODELS_PATH=./path/to/models, OR\n' +
      '3. Ensure ./models/index.js exports { sequelize }');
  }

  const options = {
    generateSQL: false, // Skip SQL generation for existing models
    includeThroughModels: process.env.INCLUDE_THROUGH_MODELS === 'true'
  };

  const analyzer = new SequelizeModelAnalyzer(sequelize, options);

  try {
    // Analyze model structure
    const structure = await analyzer.analyzeModels();

    logger.success(`📋 Model analysis complete:`);
    logger.info(`   - Models: ${structure.tables.length}`);
    logger.info(`   - Associations: ${structure.relationships.length}`);

    // Show model summary
    if (structure.tables.length > 0) {
      logger.info('📑 Models found:');
      structure.tables.forEach(table => {
        const pkCount = table.primaryKeys.length;
        const fkCount = table.foreignKeys.length;
        logger.info(`   - ${table.stats.modelName} → ${table.displayName} (${table.columns.length} attributes, ${pkCount} PK, ${fkCount} FK)`);
      });
    }

    // Generate outputs
    const outputDir = process.env.OUTPUT_DIR || './output';
    await analyzer.generateSVGDiagram(outputDir);

    // Export model structure for debugging
    if (process.env.EXPORT_MODEL_JSON === 'true') {
      const fs = require('fs').promises;
      const jsonPath = path.join(outputDir, 'model_structure.json');
      await fs.writeFile(jsonPath, JSON.stringify(analyzer.exportModelStructure(), null, 2));
      logger.info(`   - model_structure.json (exported for debugging)`);
    }

    logger.success('✅ Model visualization generated successfully!');
    logger.info(`📁 Output directory: ${outputDir}`);
    logger.info(`   - database_diagram.svg (from Sequelize models)`);

  } catch (error) {
    await analyzer.close();
    throw error;
  }

  await analyzer.close();
}

// Handle uncaught exceptions gracefully
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  main, 
  analyzeDatabaseConnection, 
  analyzeSequelizeModels,
  DatabaseAnalyzer,
  SequelizeModelAnalyzer 
};