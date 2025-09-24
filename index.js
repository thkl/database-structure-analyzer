#!/usr/bin/env node

const { ConfigManager } = require('./lib/ConfigManager');
const { DatabaseAnalyzer } = require('./lib/DatabaseAnalyzer');
const { logger } = require('./lib/utils');

async function main() {
  try {
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

  } catch (error) {
    logger.error('❌ Error:', error.message);
    
    if (process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
    
    // Provide helpful suggestions based on error type
    if (error.message.includes('ECONNREFUSED')) {
      logger.warn('💡 Suggestions:');
      logger.warn('   - Check if database server is running');
      logger.warn('   - Verify host and port settings');
      logger.warn('   - Check firewall settings');
    } else if (error.message.includes('Access denied') || error.message.includes('authentication failed')) {
      logger.warn('💡 Suggestions:');
      logger.warn('   - Verify username and password');
      logger.warn('   - Check user permissions');
      logger.warn('   - Ensure user can access the specified database');
    } else if (error.message.includes('No tables found')) {
      logger.warn('💡 Suggestions:');
      logger.warn('   - Verify database name is correct');
      logger.warn('   - Check user has SELECT permissions on system tables');
      logger.warn('   - For PostgreSQL, ensure correct schema permissions');
      logger.warn('   - For MSSQL, check database and schema access');
    }
    
    process.exit(1);
  }
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

module.exports = { main };