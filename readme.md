# Database Structure Analyzer

A powerful Node.js application that analyzes database structures, generates SQL files, and creates beautiful SVG visualizations of your database schema. Supports multiple database systems through Sequelize ORM with comprehensive error handling and validation.

## Features

- 🔍 **Multi-Database Support**: Works with MySQL, PostgreSQL, SQLite, MariaDB, and SQL Server (MSSQL)
- 📊 **Structure Analysis**: Extracts tables, columns, indexes, and relationships
- 📄 **SQL Generation**: Creates CREATE TABLE statements and schema exports
- 🎨 **SVG Visualization**: Generates beautiful Entity Relationship Diagrams
- 🔗 **Relationship Detection**: Automatically identifies foreign key relationships
- ⚡ **Easy Configuration**: Environment-based configuration with validation
- 🛡️ **Robust Error Handling**: Detects common issues with helpful suggestions
- 📋 **Progress Reporting**: Shows analysis progress for large databases
- 🎯 **Modular Design**: Clean, maintainable code structure

## Installation

1. Clone or download the project files
2. Install dependencies:

```bash
npm install
```

3. Copy the environment configuration:

```bash
cp .env.example .env
```

4. Update the `.env` file with your database credentials

## Configuration

Edit the `.env` file with your database connection details:

```env
DB_DIALECT=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
```

### Validate Configuration

Test your configuration before running the full analysis:

```bash
npm run validate-config
```

### SVG Diagram Configuration

You can customize the appearance and routing behavior of the generated SVG diagrams by setting these environment variables:

```env
# Canvas and layout spacing
SVG_CANVAS_MARGIN=100        # Margin around entire diagram (default: 100px)
SVG_CONNECTION_MARGIN=25     # Space before lines turn from tables (default: 25px)

# Collision detection and visual buffers  
SVG_COLLISION_BUFFER=25      # Minimum collision safety distance (default: 25px)
SVG_VISUAL_BUFFER=50         # Additional visual spacing (default: 50px)

# Routing behavior
SVG_SAFE_ZONE_OFFSET=40      # Safe zone offset from margins (default: 40px)
SVG_ROUTING_SPACING_TOP=120  # Top routing corridor spacing (default: 120px) 
SVG_ROUTING_SPACING_SIDE=40  # Side routing corridor spacing (default: 40px)
```

**Example configurations:**

**Compact layout** (for small diagrams):
```env
SVG_CANVAS_MARGIN=60
SVG_CONNECTION_MARGIN=15
SVG_VISUAL_BUFFER=25
```

**Spacious layout** (for complex diagrams):
```env
SVG_CANVAS_MARGIN=150
SVG_CONNECTION_MARGIN=35
SVG_VISUAL_BUFFER=70
```

### Supported Database Dialects

- **MySQL**: `mysql`
- **PostgreSQL**: `postgres` 
- **SQLite**: `sqlite`
- **MariaDB**: `mariadb`
- **SQL Server**: `mssql`

### Database-Specific Configuration

#### MySQL/MariaDB
```env
DB_DIALECT=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database
DB_USER=username
DB_PASSWORD=password
```

#### PostgreSQL
```env
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=username
DB_PASSWORD=password
```

#### SQLite
```env
DB_DIALECT=sqlite
DB_NAME=./path/to/database.sqlite
```

#### SQL Server (MSSQL)
```env
DB_DIALECT=mssql
DB_HOST=localhost
DB_PORT=1433
DB_NAME=your_database
DB_USER=username
DB_PASSWORD=password
DB_INSTANCE_NAME=SQLEXPRESS
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
```

## Usage

### Basic Usage

Run the analyzer with your configured database:

```bash
npm start
```

or

```bash
node index.js
```

### Development Mode

For development with auto-reload:

```bash
npm run dev
```

## Output Files

The application generates two main output files in the `./output` directory:

### 1. SQL Files (`create_tables.sql`)
- Complete CREATE TABLE statements
- Primary key definitions
- Foreign key constraints
- Column types and constraints

### 2. SVG Diagram (`database_diagram.svg`)
- Visual representation of your database structure
- Tables with columns and data types
- Primary keys (🔑) and foreign keys (🔗) highlighted
- Relationship lines connecting related tables

## Example Output Structure

```
output/
├── create_tables.sql
└── database_diagram.svg
```

## Code Structure

The application consists of several key classes:

- **DatabaseAnalyzer**: Main class that handles database connection and analysis
- **SVGDiagramGenerator**: Generates the visual SVG representation
- **Table Analysis**: Extracts column information, indexes, and constraints
- **Relationship Detection**: Identifies foreign key relationships between tables

## Features in Detail

### Database Analysis
- Extracts complete table structures
- Identifies column types, constraints, and properties
- Detects primary keys and unique constraints
- Discovers indexes and their properties
- Maps foreign key relationships

### SQL Generation
- Creates syntactically correct CREATE TABLE statements
- Includes all column definitions and constraints
- Generates ALTER TABLE statements for foreign keys
- Properly formats data types for target database

### SVG Visualization
- Automatically positions tables in a grid layout
- Color-codes different types of columns
- Draws relationship lines between connected tables
- Scalable vector format for high-quality output

## Error Handling

The application includes comprehensive error handling for:
- Database connection failures
- Invalid table structures
- Missing foreign key information
- File system operations

## Project Structure

```
database-structure-analyzer/
├── index.js                      # Main entry point and CLI
├── package.json                  # Dependencies and scripts  
├── .env.example                  # Configuration template
├── .env                         # Your configuration
├── lib/                         # Core modules
│   ├── ConfigManager.js         # Configuration management
│   ├── DatabaseAnalyzer.js      # Database analysis engine
│   ├── SVGDiagramGenerator.js   # SVG diagram creation
│   ├── QueryBuilder.js          # Database-specific queries
│   └── utils.js                 # Utilities and logging
└── output/                      # Generated files
    ├── create_tables.sql        # Database schema
    └── database_diagram.svg     # ER diagram
```

## Code Structure

The application uses a modular design with clear separation of concerns:

- **ConfigManager**: Handles environment configuration and validation
- **DatabaseAnalyzer**: Core analysis engine with connection management
- **QueryBuilder**: Database-specific SQL query generation  
- **SVGDiagramGenerator**: Creates visual ER diagrams
- **Utils**: Logging, validation, and utility functions

Each module includes comprehensive error handling and provides specific guidance for resolving issues.

## Requirements

- Node.js 14.0.0 or higher
- Access to your target database
- Appropriate database drivers (automatically installed)

## Troubleshooting

The application provides detailed error messages and suggestions for common issues:

### Connection Issues
```
❌ Database connection failed: ECONNREFUSED
💡 Suggestions:
   - Check if database server is running
   - Verify host and port settings  
   - Check firewall settings
```

### Authentication Problems
```
❌ Access denied: authentication failed
💡 Suggestions:
   - Verify username and password
   - Check user permissions
   - Ensure user can access the specified database
```

### Empty Database (0 Tables)
```
❌ No tables found in database
💡 Suggestions:
   - Verify database name is correct
   - Check user has SELECT permissions on system tables
   - For PostgreSQL, ensure correct schema permissions
   - For MSSQL, check database and schema access
```

### Configuration Validation
Run `npm run validate-config` to test your `.env` settings before analysis.

### Debug Mode
Set `NODE_ENV=development` in your `.env` file for detailed error traces and debug information.

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve the application.

## License

MIT License - feel free to use this code for your projects!

---

## Sample Usage

Here's what the console output looks like:

```
🚀 Starting Database Structure Analyzer...
📊 Configuration: { database: 'test_db', username: 'root', host: 'localhost', port: 3306, dialect: 'mysql' }
✅ Database connection established successfully.
🔍 Analyzing database structure...
📋 Found 5 tables
📋 Analysis complete:
   - Tables: 5
   - Relationships: 3
📄 SQL files generated in ./output
🎨 SVG diagram generated in ./output
✅ All files generated successfully!
🔌 Database connection closed.
```