class QueryBuilder {
  constructor(dialect, databaseName) {
    this.dialect = dialect;
    this.databaseName = databaseName;
  }

  // Test database access by trying to list tables
  getDatabaseAccessTestQuery() {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return `SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = '${this.databaseName}'`;
        
      case 'postgres':
        return `SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_catalog = '${this.databaseName}' AND table_schema = 'public'`;
        
      case 'mssql':
        return `SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_catalog = '${this.databaseName}'`;
        
      case 'sqlite':
        return `SELECT COUNT(*) as table_count FROM sqlite_master WHERE type = 'table'`;
        
      default:
        throw new Error(`Unsupported dialect for access test: ${this.dialect}`);
    }
  }

  // Get foreign key relationships for a specific table
  getForeignKeysQuery(tableName, schema = null) {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return `
          SELECT 
            COLUMN_NAME as column_name,
            REFERENCED_TABLE_NAME as referenced_table,
            REFERENCED_COLUMN_NAME as referenced_column,
            CONSTRAINT_NAME as constraint_name
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
          WHERE TABLE_NAME = '${tableName}' 
          AND TABLE_SCHEMA = '${this.databaseName}'
          AND REFERENCED_TABLE_NAME IS NOT NULL
        `;

      case 'postgres':
        return `
          SELECT 
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            tc.constraint_name
          FROM information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_name = '${tableName}'
          AND tc.table_catalog = '${this.databaseName}'
        `;

      case 'mssql':
        const schemaFilter = schema ? `AND OBJECT_SCHEMA_NAME(fc.parent_object_id) = '${schema}'` : '';
        return `
          SELECT 
            COL_NAME(fc.parent_object_id, fc.parent_column_id) AS column_name,
            OBJECT_NAME(fc.referenced_object_id) AS referenced_table,
            COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS referenced_column,
            f.name AS constraint_name,
            OBJECT_SCHEMA_NAME(fc.referenced_object_id) AS referenced_schema
          FROM sys.foreign_keys AS f
          INNER JOIN sys.foreign_key_columns AS fc ON f.object_id = fc.constraint_object_id
          WHERE OBJECT_NAME(fc.parent_object_id) = '${tableName}'
          ${schemaFilter}
          AND DB_NAME() = '${this.databaseName}'
        `;

      case 'sqlite':
        // SQLite uses PRAGMA foreign_key_list
        return `PRAGMA foreign_key_list('${tableName}')`;

      default:
        throw new Error(`Unsupported dialect for foreign keys: ${this.dialect}`);
    }
  }

  // Get detailed table information including comments
  getTableInfoQuery(tableName, schema = null) {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return `
          SELECT 
            TABLE_COMMENT as table_comment,
            ENGINE as engine,
            TABLE_ROWS as estimated_rows,
            AVG_ROW_LENGTH as avg_row_length,
            DATA_LENGTH as data_length
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = '${tableName}' 
          AND TABLE_SCHEMA = '${this.databaseName}'
        `;

      case 'postgres':
        return `
          SELECT 
            obj_description(c.oid, 'pg_class') as table_comment,
            pg_size_pretty(pg_total_relation_size(c.oid)) as table_size,
            reltuples as estimated_rows
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = '${tableName}'
          AND n.nspname = 'public'
        `;

      case 'mssql':
        const schemaFilter = schema ? `AND OBJECT_SCHEMA_NAME(t.object_id) = '${schema}'` : '';
        return `
          SELECT 
            ep.value as table_comment,
            p.rows as estimated_rows,
            SUM(a.total_pages) * 8 as size_kb
          FROM sys.tables t
          LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0
          LEFT JOIN sys.partitions p ON p.object_id = t.object_id
          LEFT JOIN sys.allocation_units a ON a.container_id = p.partition_id
          WHERE t.name = '${tableName}'
          ${schemaFilter}
          GROUP BY ep.value, p.rows
        `;

      case 'sqlite':
        // SQLite doesn't have comments or detailed stats
        return `SELECT '${tableName}' as table_name, 'sqlite' as engine`;

      default:
        return null;
    }
  }

  // Get all indexes for a table
  getIndexesQuery(tableName) {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return `
          SELECT 
            INDEX_NAME as index_name,
            COLUMN_NAME as column_name,
            NON_UNIQUE = 0 as is_unique,
            INDEX_TYPE as index_type,
            SEQ_IN_INDEX as column_position
          FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_NAME = '${tableName}' 
          AND TABLE_SCHEMA = '${this.databaseName}'
          ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `;

      case 'postgres':
        return `
          SELECT 
            i.relname as index_name,
            a.attname as column_name,
            ix.indisunique as is_unique,
            am.amname as index_type,
            array_position(ix.indkey, a.attnum) as column_position
          FROM pg_class t
          JOIN pg_index ix ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_attribute a ON t.oid = a.attrelid AND a.attnum = ANY(ix.indkey)
          JOIN pg_am am ON i.relam = am.oid
          WHERE t.relname = '${tableName}'
          ORDER BY i.relname, array_position(ix.indkey, a.attnum)
        `;

      case 'mssql':
        return `
          SELECT 
            i.name as index_name,
            c.name as column_name,
            i.is_unique,
            t.name as index_type,
            ic.key_ordinal as column_position
          FROM sys.indexes i
          JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          JOIN sys.types t ON i.type = t.user_type_id
          WHERE OBJECT_NAME(i.object_id) = '${tableName}'
          ORDER BY i.name, ic.key_ordinal
        `;

      case 'sqlite':
        return `PRAGMA index_list('${tableName}')`;

      default:
        return null;
    }
  }

  // Check if database exists and is accessible
  getDatabaseExistsQuery() {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${this.databaseName}'`;

      case 'postgres':
        return `SELECT datname FROM pg_database WHERE datname = '${this.databaseName}'`;

      case 'mssql':
        return `SELECT name FROM sys.databases WHERE name = '${this.databaseName}'`;

      case 'sqlite':
        // For SQLite, we'll check if file exists and is readable
        return null;

      default:
        return null;
    }
  }

  // Get current database name (useful for validation)
  getCurrentDatabaseQuery() {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return 'SELECT DATABASE() as current_db';

      case 'postgres':
        return 'SELECT current_database() as current_db';

      case 'mssql':
        return 'SELECT DB_NAME() as current_db';

      case 'sqlite':
        return "SELECT 'main' as current_db";

      default:
        return null;
    }
  }

  // Get user permissions (helpful for debugging access issues)
  getUserPermissionsQuery() {
    switch (this.dialect) {
      case 'mysql':
      case 'mariadb':
        return 'SHOW GRANTS FOR CURRENT_USER()';

      case 'postgres':
        return `
          SELECT 
            table_name,
            privilege_type,
            is_grantable
          FROM information_schema.role_table_grants 
          WHERE grantee = current_user
        `;

      case 'mssql':
        return `
          SELECT 
            dp.permission_name,
            dp.state_desc,
            o.name as object_name
          FROM sys.database_permissions dp
          LEFT JOIN sys.objects o ON dp.major_id = o.object_id
          WHERE dp.grantee_principal_id = USER_ID()
        `;

      case 'sqlite':
        // SQLite doesn't have user permissions
        return null;

      default:
        return null;
    }
  }
}

module.exports = { QueryBuilder };