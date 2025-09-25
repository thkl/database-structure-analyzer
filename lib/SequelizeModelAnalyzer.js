const { SVGDiagramGenerator } = require('./SVGDiagramGenerator');
const { 
  logger, 
  validateDatabaseStructure, 
  writeFileWithBackup, 
  Timer 
} = require('./utils');
const path = require('path');

class SequelizeModelAnalyzer {
  constructor(sequelize, options = {}) {
    this.sequelize = sequelize;
    this.options = {
      generateSQL: false, // Skip SQL generation for existing models
      includeThroughModels: false, // Include junction tables for many-to-many
      ...options
    };
    this.tables = [];
    this.relationships = [];
  }

  async analyzeModels() {
    const timer = new Timer();
    
    try {
      logger.info('🔍 Analyzing Sequelize models...');
      
      const models = Object.values(this.sequelize.models);
      
      if (models.length === 0) {
        logger.warn('⚠️  No Sequelize models found');
        return {
          tables: [],
          relationships: []
        };
      }

      logger.info(`📋 Found ${models.length} models`);

      // Analyze each model
      let processedModels = 0;
      for (const model of models) {
        try {
          // Skip through models unless explicitly requested
          if (!this.options.includeThroughModels && this.isJunctionModel(model)) {
            continue;
          }

          const tableInfo = this.analyzeModel(model);
          this.tables.push(tableInfo);
          processedModels++;
          
          if (processedModels % 5 === 0 || processedModels === models.length) {
            logger.info(`   📊 Processed ${processedModels} models`);
          }
        } catch (error) {
          logger.warn(`⚠️  Failed to analyze model '${model.name}': ${error.message}`);
        }
      }

      // Analyze relationships
      logger.info('🔗 Analyzing model relationships...');
      this.analyzeModelRelationships(models);

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

      logger.success(`✅ Model analysis completed in ${timer.elapsedFormatted()}`);
      return structure;
      
    } catch (error) {
      logger.error(`❌ Model analysis failed: ${error.message}`);
      throw error;
    }
  }

  analyzeModel(model) {
    const attributes = model.getAttributes();
    const tableName = model.getTableName();
    const schema = model.options?.schema;
    
    // Build table info from model attributes
    const columns = Object.keys(attributes).map(attrName => {
      const attr = attributes[attrName];
      
      return {
        name: attrName,
        type: this.normalizeDataType(attr.type),
        allowNull: attr.allowNull !== false,
        defaultValue: attr.defaultValue,
        primaryKey: attr.primaryKey || false,
        autoIncrement: attr.autoIncrement || false,
        unique: attr.unique || false,
        comment: attr.comment || null
      };
    });

    // Extract primary keys
    const primaryKeys = columns
      .filter(col => col.primaryKey)
      .map(col => col.name);

    // Get foreign keys from associations
    const foreignKeys = this.extractForeignKeysFromModel(model);

    // Create display names with schema if available
    const displayName = schema ? `${schema}.${tableName}` : tableName;
    const fullName = displayName;

    return {
      name: typeof tableName === 'string' ? tableName : tableName.tableName || model.name,
      schema: schema || null,
      fullName: fullName,
      displayName: displayName,
      model: model, // Keep reference for relationship analysis
      columns: columns,
      indexes: [], // Could be enhanced to extract index info
      primaryKeys: primaryKeys,
      foreignKeys: foreignKeys,
      stats: {
        isModel: true,
        modelName: model.name,
        tableName: tableName
      }
    };
  }

  extractForeignKeysFromModel(model) {
    const foreignKeys = [];
    
    // Analyze model associations
    Object.values(model.associations).forEach(association => {
      if (association.associationType === 'BelongsTo') {
        const foreignKey = association.foreignKey;
        const targetKey = association.targetKey || 'id';
        const targetModel = association.target;
        const targetTable = targetModel.getTableName();
        const targetSchema = targetModel.options?.schema;
        
        const referencedTable = targetSchema ? `${targetSchema}.${targetTable}` : 
                               (typeof targetTable === 'string' ? targetTable : targetTable.tableName);
        
        foreignKeys.push({
          column: foreignKey,
          referencedTable: referencedTable,
          referencedColumn: targetKey,
          constraintName: `fk_${model.name}_${foreignKey}`,
          referencedSchema: targetSchema || null,
          associationType: 'BelongsTo',
          associationName: association.as
        });
      }
    });

    return foreignKeys;
  }

  analyzeModelRelationships(models) {
    const relationshipMap = new Map();
    
    models.forEach(model => {
      Object.values(model.associations).forEach(association => {
        const relationship = this.createRelationshipFromAssociation(model, association);
        if (relationship) {
          const key = `${relationship.fromTable}.${relationship.fromColumn}->${relationship.toTable}.${relationship.toColumn}`;
          
          if (!relationshipMap.has(key)) {
            relationshipMap.set(key, relationship);
            this.relationships.push(relationship);
          }
        }
      });
    });

    logger.info(`   🔗 Found ${this.relationships.length} relationships`);
  }

  createRelationshipFromAssociation(model, association) {
    const fromTable = this.getTableDisplayName(model);
    
    switch (association.associationType) {
      case 'BelongsTo':
        return {
          fromTable: fromTable,
          fromColumn: association.foreignKey,
          toTable: this.getTableDisplayName(association.target),
          toColumn: association.targetKey || 'id',
          constraintName: `fk_${model.name}_${association.foreignKey}`,
          type: 'many-to-one',
          associationType: 'BelongsTo',
          associationName: association.as
        };
        
      case 'HasMany':
        return {
          fromTable: fromTable,
          fromColumn: association.sourceKey || 'id',
          toTable: this.getTableDisplayName(association.target),
          toColumn: association.foreignKey,
          constraintName: `fk_${association.target.name}_${association.foreignKey}`,
          type: 'one-to-many',
          associationType: 'HasMany',
          associationName: association.as
        };
        
      case 'HasOne':
        return {
          fromTable: fromTable,
          fromColumn: association.sourceKey || 'id',
          toTable: this.getTableDisplayName(association.target),
          toColumn: association.foreignKey,
          constraintName: `fk_${association.target.name}_${association.foreignKey}`,
          type: 'one-to-one',
          associationType: 'HasOne',
          associationName: association.as
        };
        
      case 'BelongsToMany':
        // Handle many-to-many relationships
        if (this.options.includeThroughModels && association.through) {
          return {
            fromTable: fromTable,
            fromColumn: association.otherKey,
            toTable: this.getTableDisplayName(association.target),
            toColumn: association.targetKey || 'id',
            constraintName: `fk_${association.through.model?.name || 'junction'}_${association.otherKey}`,
            type: 'many-to-many',
            associationType: 'BelongsToMany',
            associationName: association.as,
            throughModel: association.through.model?.name
          };
        }
        return null;
        
      default:
        return null;
    }
  }

  getTableDisplayName(model) {
    const tableName = model.getTableName();
    const schema = model.options?.schema;
    
    const name = typeof tableName === 'string' ? tableName : tableName.tableName || model.name;
    return schema ? `${schema}.${name}` : name;
  }

  isJunctionModel(model) {
    // Heuristic to detect junction/through tables
    const associations = Object.values(model.associations);
    const belongsToCount = associations.filter(a => a.associationType === 'BelongsTo').length;
    const totalAttributes = Object.keys(model.getAttributes()).length;
    
    // Junction tables typically have mostly BelongsTo associations and few attributes
    return belongsToCount >= 2 && totalAttributes <= belongsToCount + 2;
  }

  normalizeDataType(sequelizeType) {
    // Convert Sequelize data types to readable strings
    if (typeof sequelizeType === 'string') return sequelizeType;
    
    const typeString = sequelizeType.toString();
    
    // Handle common Sequelize types
    const typeMap = {
      'INTEGER': 'INT',
      'STRING': 'VARCHAR',
      'TEXT': 'TEXT',
      'BOOLEAN': 'BOOLEAN',
      'DATE': 'DATETIME',
      'DECIMAL': 'DECIMAL',
      'FLOAT': 'FLOAT',
      'DOUBLE': 'DOUBLE',
      'UUID': 'UUID',
      'JSON': 'JSON',
      'JSONB': 'JSONB'
    };

    // Extract base type
    const baseType = typeString.split('(')[0].toUpperCase();
    return typeMap[baseType] || typeString;
  }

  async generateSVGDiagram(outputDir, options = {}) {
    const timer = new Timer();
    
    try {
      logger.info('🎨 Generating SVG diagram from models...');
      
      const svgOptions = {
        colorScheme: 'modern',
        showDataTypes: true,
        showConstraints: true,
        debugPaths: process.env.DEBUG_PATHS === 'true',
        
        // Use environment variables or defaults
        canvasMargin: parseInt(process.env.SVG_CANVAS_MARGIN) || 100,
        connectionMargin: parseInt(process.env.SVG_CONNECTION_MARGIN) || 25,
        collisionBuffer: parseInt(process.env.SVG_COLLISION_BUFFER) || 25,
        visualBuffer: parseInt(process.env.SVG_VISUAL_BUFFER) || 50,
        safeZoneOffset: parseInt(process.env.SVG_SAFE_ZONE_OFFSET) || 40,
        routingSpacingTop: parseInt(process.env.SVG_ROUTING_SPACING_TOP) || 60,
        routingSpacingSide: parseInt(process.env.SVG_ROUTING_SPACING_SIDE) || 40,
        
        ...options
      };
      
      const generator = new SVGDiagramGenerator(this.tables, this.relationships, svgOptions);
      const filePath = await generator.generateToFile(outputDir);
      
      logger.success(`✅ SVG diagram generated: ${path.basename(filePath)} (${timer.elapsedFormatted()})`);
      
      if (svgOptions.debugPaths) {
        logger.info('🐛 Debug mode enabled - model relationships and buffers visible');
      }
      
      return filePath;
      
    } catch (error) {
      throw new Error(`Failed to generate SVG diagram: ${error.message}`);
    }
  }

  // Export model structure as JSON (useful for debugging)
  exportModelStructure() {
    return {
      models: this.tables.map(table => ({
        name: table.name,
        tableName: table.fullName,
        schema: table.schema,
        columns: table.columns,
        primaryKeys: table.primaryKeys,
        foreignKeys: table.foreignKeys,
        modelName: table.stats?.modelName
      })),
      relationships: this.relationships.map(rel => ({
        from: `${rel.fromTable}.${rel.fromColumn}`,
        to: `${rel.toTable}.${rel.toColumn}`,
        type: rel.type,
        associationType: rel.associationType,
        associationName: rel.associationName
      }))
    };
  }

  async close() {
    // No database connection to close when working with models
    logger.info('📝 Model analysis session completed');
  }
}

module.exports = { SequelizeModelAnalyzer };