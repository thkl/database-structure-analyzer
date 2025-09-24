const fs = require('fs').promises;
const path = require('path');

// Simple logger with colors
const logger = {
  info: (message) => {
    console.log(`\x1b[36m${message}\x1b[0m`);
  },
  
  success: (message) => {
    console.log(`\x1b[32m${message}\x1b[0m`);
  },
  
  warn: (message) => {
    console.log(`\x1b[33m${message}\x1b[0m`);
  },
  
  error: (message) => {
    console.log(`\x1b[31m${message}\x1b[0m`);
  }
};

// File system utilities
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`📁 Created directory: ${dirPath}`);
    } else {
      throw error;
    }
  }
}

async function writeFileWithBackup(filePath, content) {
  const dir = path.dirname(filePath);
  await ensureDirectoryExists(dir);
  
  // Create backup if file exists
  try {
    await fs.access(filePath);
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
    logger.info(`📋 Created backup: ${path.basename(backupPath)}`);
  } catch (error) {
    // File doesn't exist, no backup needed
  }
  
  await fs.writeFile(filePath, content, 'utf8');
}

// Data validation utilities
function validateTableStructure(table) {
  const errors = [];
  
  if (!table.name || typeof table.name !== 'string') {
    errors.push('Table must have a valid name');
  }
  
  if (!Array.isArray(table.columns) || table.columns.length === 0) {
    errors.push(`Table ${table.name} has no columns`);
  }
  
  // Validate columns
  table.columns.forEach((column, index) => {
    if (!column.name || typeof column.name !== 'string') {
      errors.push(`Table ${table.name}: Column ${index} has invalid name`);
    }
    
    if (!column.type || typeof column.type !== 'string') {
      errors.push(`Table ${table.name}: Column ${column.name} has invalid type`);
    }
  });
  
  // Validate foreign keys
  if (table.foreignKeys) {
    table.foreignKeys.forEach((fk, index) => {
      if (!fk.column || !fk.referencedTable || !fk.referencedColumn) {
        errors.push(`Table ${table.name}: Foreign key ${index} is incomplete`);
      }
    });
  }
  
  return errors;
}

function validateDatabaseStructure(structure) {
  const errors = [];
  
  if (!structure.tables || !Array.isArray(structure.tables)) {
    errors.push('Structure must contain tables array');
    return errors;
  }
  
  if (structure.tables.length === 0) {
    errors.push('No tables found in database structure');
    return errors;
  }
  
  // Validate each table
  structure.tables.forEach(table => {
    const tableErrors = validateTableStructure(table);
    errors.push(...tableErrors);
  });
  
  // Validate relationships reference existing tables
  if (structure.relationships) {
    const tableNames = new Set(structure.tables.map(t => t.name));
    
    structure.relationships.forEach((rel, index) => {
      if (!tableNames.has(rel.fromTable)) {
        errors.push(`Relationship ${index}: fromTable "${rel.fromTable}" not found`);
      }
      
      if (!tableNames.has(rel.toTable)) {
        errors.push(`Relationship ${index}: toTable "${rel.toTable}" not found`);
      }
    });
  }
  
  return errors;
}

// String utilities
function sanitizeFileName(filename) {
  return filename
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Database-specific utilities
function escapeIdentifier(identifier, dialect) {
  switch (dialect) {
    case 'mssql':
      return `[${identifier}]`;
    case 'postgres':
      return `"${identifier}"`;
    case 'mysql':
    case 'mariadb':
      return `\`${identifier}\``;
    case 'sqlite':
      return `"${identifier}"`;
    default:
      return identifier;
  }
}

function getDialectQuoteChar(dialect) {
  switch (dialect) {
    case 'mssql':
      return ['[', ']'];
    case 'postgres':
    case 'sqlite':
      return ['"', '"'];
    case 'mysql':
    case 'mariadb':
      return ['`', '`'];
    default:
      return ['', ''];
  }
}

// Performance monitoring
class Timer {
  constructor() {
    this.start = Date.now();
  }
  
  elapsed() {
    return Date.now() - this.start;
  }
  
  elapsedFormatted() {
    return formatDuration(this.elapsed());
  }
}

module.exports = {
  logger,
  ensureDirectoryExists,
  writeFileWithBackup,
  validateTableStructure,
  validateDatabaseStructure,
  sanitizeFileName,
  formatBytes,
  formatDuration,
  escapeIdentifier,
  getDialectQuoteChar,
  Timer
};