const { writeFileWithBackup } = require('./utils');
const { DiagramMath } = require('./DiagramMath');
const path = require('path');

class SVGDiagramGenerator {
  constructor(tables, relationships, options = {}) {
    this.tables = tables;
    this.relationships = relationships;
    this.options = {
      // Table layout options
      minTableWidth: 200,
      maxTableWidth: 400,
      tableHeaderHeight: 35,
      columnHeight: 22,
      tablePadding: 60,
      canvasMargin: 100, // Large margin around entire canvas for safe routing
      
      // Connection and routing options
      connectionMargin: 25, // Space before lines can turn from table edges
      collisionBuffer: 25, // Minimum safety distance for collision detection
      visualBuffer: 50, // Additional spacing for professional appearance
      safeZoneOffset: 40, // How much to offset from canvas margin for safe routing
      routingSpacingTop: 60, // Extra spacing from top edge for routing
      routingSpacingSide: 40, // Extra spacing from side edges for routing
      
      // Text and display options
      fontSize: 12,
      headerFontSize: 14,
      maxColumns: 15, // Truncate tables with too many columns
      showDataTypes: true,
      showConstraints: true,
      colorScheme: 'modern', // modern, classic, minimal
      textPadding: 24, // Extra padding for text within tables
      
      // Debug options
      debugPaths: false, // Show debug info for pathfinding
      
      ...options
    };
    
    this.tablePositions = new Map();
    this.tableWidths = new Map(); // Store calculated width for each table
    this.colors = this.getColorScheme();
    this.math = new DiagramMath(this.options); // Mathematical calculations
  }

  getColorScheme() {
    const schemes = {
      modern: {
        tableHeader: '#2c3e50',
        tableBody: '#ffffff',
        tableBorder: '#34495e',
        primaryKey: '#e74c3c',
        foreignKey: '#3498db',
        regularColumn: '#2c3e50',
        relationship: '#7f8c8d',
        background: '#f8f9fa'
      },
      classic: {
        tableHeader: '#4a90e2',
        tableBody: '#ffffff',
        tableBorder: '#2c3e50',
        primaryKey: '#d32f2f',
        foreignKey: '#1976d2',
        regularColumn: '#424242',
        relationship: '#666666',
        background: '#ffffff'
      },
      minimal: {
        tableHeader: '#333333',
        tableBody: '#ffffff',
        tableBorder: '#cccccc',
        primaryKey: '#000000',
        foreignKey: '#666666',
        regularColumn: '#333333',
        relationship: '#999999',
        background: '#ffffff'
      }
    };

    return schemes[this.options.colorScheme] || schemes.modern;
  }

  // Calculate optimal width for each table based on content
  calculateTableWidths() {
    for (const table of this.tables) {
      let maxWidth = this.options.minTableWidth;
      
      // Check table name width
      const displayName = table.displayName || table.fullName || table.name;
      const titleWidth = this.math.estimateTextWidth(displayName, this.options.headerFontSize) + this.options.textPadding;
      maxWidth = Math.max(maxWidth, titleWidth);
      
      // Check each column width
      const visibleColumns = table.columns.slice(0, this.options.maxColumns);
      for (const column of visibleColumns) {
        const isPK = table.primaryKeys && table.primaryKeys.includes(column.name);
        const isFK = table.foreignKeys && table.foreignKeys.some(fk => fk.column === column.name);
        
        let prefix = '';
        if (isPK) {
          prefix = '🔑 ';
        } else if (isFK) {
          prefix = '🔗 ';
        }

        const displayType = this.options.showDataTypes ? ` : ${this.simplifyDataType(column.type)}` : '';
        const nullability = this.options.showConstraints && !column.allowNull ? ' NOT NULL' : '';
        const fullColumnText = `${prefix}${column.name}${displayType}${nullability}`;
        
        const columnWidth = this.math.estimateTextWidth(fullColumnText, this.options.fontSize) + this.options.textPadding;
        maxWidth = Math.max(maxWidth, columnWidth);
      }
      
      // Check "... and X more columns" text if applicable
      if (table.columns.length > this.options.maxColumns) {
        const remaining = table.columns.length - this.options.maxColumns;
        const moreText = `... and ${remaining} more columns`;
        const moreWidth = this.math.estimateTextWidth(moreText, this.options.fontSize) + this.options.textPadding;
        maxWidth = Math.max(maxWidth, moreWidth);
      }
      
      // Apply limits
      maxWidth = Math.min(maxWidth, this.options.maxTableWidth);
      maxWidth = Math.max(maxWidth, this.options.minTableWidth);
      
      this.tableWidths.set(table.name, Math.ceil(maxWidth));
    }
  }

  // Get the width for a specific table
  getTableWidth(table) {
    return this.tableWidths.get(table.name) || this.options.minTableWidth;
  }

  async generateToFile(outputDir) {
    const svg = this.generate();
    const filePath = path.join(outputDir, 'database_diagram.svg');
    await writeFileWithBackup(filePath, svg);
    return filePath;
  }

  generate() {
    if (this.tables.length === 0) {
      return this.generateEmptyDiagram();
    }

    // First, calculate optimal width for each table
    this.calculateTableWidths();
    
    // Then calculate positions with the new widths
    this.calculatePositions();
    
    const bounds = this.calculateCanvasBounds();
    const svgWidth = bounds.width;
    const svgHeight = bounds.height;

    let svg = this.generateSVGHeader(svgWidth, svgHeight);

    // Add background
    svg += `  <rect width="100%" height="100%" fill="${this.colors.background}"/>\n\n`;

    // Draw relationships first (so they appear behind tables)
    svg += '  <!-- Relationships -->\n';
    for (const relationship of this.relationships) {
      svg += this.drawRelationship(relationship);
    }

    // Draw tables
    svg += '\n  <!-- Tables -->\n';
    for (const table of this.tables) {
      svg += this.drawTable(table);
    }

    // Add title and legend
    svg += this.drawTitle();
    svg += this.drawLegend(svgWidth, svgHeight);

    svg += '</svg>';
    return svg;
  }

  generateEmptyDiagram() {
    const svgWidth = 600;
    const svgHeight = 400;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${this.colors.background}"/>
  
  <text x="${svgWidth/2}" y="${svgHeight/2}" 
        text-anchor="middle" 
        font-family="Arial, sans-serif" 
        font-size="18" 
        fill="#666">
    No tables found in database
  </text>
  
  <text x="${svgWidth/2}" y="${svgHeight/2 + 30}" 
        text-anchor="middle" 
        font-family="Arial, sans-serif" 
        font-size="14" 
        fill="#999">
    Check database permissions and connection
  </text>
</svg>`;
  }

  generateSVGHeader(width, height) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .table-header { 
        fill: ${this.colors.tableHeader}; 
        stroke: ${this.colors.tableBorder}; 
        stroke-width: 2; 
      }
      .table-body { 
        fill: ${this.colors.tableBody}; 
        stroke: ${this.colors.tableBorder}; 
        stroke-width: 1; 
      }
      .table-title { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
        font-size: ${this.options.headerFontSize}px; 
        font-weight: bold; 
        fill: white; 
        text-anchor: middle; 
      }
      .column-text { 
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace; 
        font-size: ${this.options.fontSize}px; 
        fill: ${this.colors.regularColumn}; 
      }
      .pk-column { 
        font-weight: bold; 
        fill: ${this.colors.primaryKey}; 
      }
      .fk-column { 
        fill: ${this.colors.foreignKey}; 
      }
      .relationship-line { 
        stroke: ${this.colors.relationship}; 
        stroke-width: 2; 
        fill: none; 
        marker-end: url(#arrowhead);
      }
      .relationship-arrow { 
        fill: ${this.colors.relationship}; 
      }
      .fk-connection-point {
        stroke: ${this.colors.foreignKey};
        stroke-width: 1;
      }
      .pk-connection-point {
        stroke: ${this.colors.primaryKey};
        stroke-width: 1;
      }
      .title-text {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-size: 20px;
        font-weight: bold;
        fill: ${this.colors.tableHeader};
        text-anchor: middle;
      }
      .legend-text {
        font-family: Arial, sans-serif;
        font-size: 11px;
        fill: ${this.colors.regularColumn};
      }
    </style>
    
    <!-- Arrow marker for relationships -->
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" 
              refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="${this.colors.relationship}" />
      </marker>
    </defs>
  </defs>
  
  <title>Database Entity Relationship Diagram</title>

`;
  }

  calculatePositions() {
    // Use a more intelligent layout algorithm that accounts for variable widths
    const cols = Math.ceil(Math.sqrt(this.tables.length * 1.2));
    let x = this.options.tablePadding + this.options.canvasMargin;
    let y = this.options.tablePadding + this.options.canvasMargin + 80; // Space for title
    let currentCol = 0;
    let maxHeightInRow = 0;
    let maxWidthInRow = 0;

    for (const table of this.tables) {
      const tableHeight = this.getTableHeight(table);
      const tableWidth = this.getTableWidth(table);
      
      maxHeightInRow = Math.max(maxHeightInRow, tableHeight);
      maxWidthInRow = Math.max(maxWidthInRow, tableWidth);
      
      this.tablePositions.set(table.name, { x, y });
      
      currentCol++;
      if (currentCol >= cols) {
        // Move to next row
        currentCol = 0;
        x = this.options.tablePadding + this.options.canvasMargin;
        y += maxHeightInRow + this.options.tablePadding;
        maxHeightInRow = 0;
        maxWidthInRow = 0;
      } else {
        // Move to next column, using the current table's width plus padding
        x += tableWidth + this.options.tablePadding;
      }
    }
  }

  calculateCanvasBounds() {
    let maxX = 0;
    let maxY = 0;

    for (const [tableName, pos] of this.tablePositions) {
      const table = this.tables.find(t => t.name === tableName);
      const tableHeight = this.getTableHeight(table);
      const tableWidth = this.getTableWidth(table);
      
      maxX = Math.max(maxX, pos.x + tableWidth);
      maxY = Math.max(maxY, pos.y + tableHeight);
    }

    return {
      width: (maxX || 800) + this.options.canvasMargin,
      height: (maxY || 600) + this.options.canvasMargin
    };
  }

  getTableHeight(table) {
    const visibleColumns = Math.min(table.columns.length, this.options.maxColumns);
    const extraHeight = table.columns.length > this.options.maxColumns ? this.options.columnHeight : 0;
    return this.options.tableHeaderHeight + (visibleColumns * this.options.columnHeight) + extraHeight + 15;
  }

  drawTable(table) {
    const pos = this.tablePositions.get(table.name);
    const tableHeight = this.getTableHeight(table);
    const tableWidth = this.getTableWidth(table);
    const visibleColumns = table.columns.slice(0, this.options.maxColumns);
    const hasMore = table.columns.length > this.options.maxColumns;
    const displayName = table.displayName || table.fullName || table.name;

    let svg = `
  <!-- Table: ${displayName} -->
  <g id="table-${table.name}">
    <!-- Table header -->
    <rect x="${pos.x}" y="${pos.y}" 
          width="${tableWidth}" 
          height="${this.options.tableHeaderHeight}" 
          class="table-header" rx="5" ry="5"/>
    
    <!-- Table body -->
    <rect x="${pos.x}" y="${pos.y + this.options.tableHeaderHeight}" 
          width="${tableWidth}" 
          height="${tableHeight - this.options.tableHeaderHeight}" 
          class="table-body" rx="0" ry="0"/>
    
    <!-- Table title -->
    <text x="${pos.x + tableWidth/2}" 
          y="${pos.y + this.options.tableHeaderHeight/2 + 6}" 
          class="table-title">${displayName}</text>
`;

    // Draw columns
    let columnY = pos.y + this.options.tableHeaderHeight + 18;
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      const isPK = table.primaryKeys && table.primaryKeys.includes(column.name);
      const isFK = table.foreignKeys && table.foreignKeys.some(fk => fk.column === column.name);
      
      let columnClass = 'column-text';
      let prefix = '';
      
      if (isPK) {
        columnClass += ' pk-column';
        prefix = '🔑 ';
      } else if (isFK) {
        columnClass += ' fk-column';
        prefix = '🔗 ';
      }

      const displayType = this.options.showDataTypes ? ` : ${this.simplifyDataType(column.type)}` : '';
      const nullability = this.options.showConstraints && !column.allowNull ? ' NOT NULL' : '';
      const fullColumnText = `${prefix}${column.name}${displayType}${nullability}`;
      
      // Truncate text if it's still too long (safety measure)
      const maxChars = Math.floor((tableWidth - this.options.textPadding) / (this.options.fontSize * 0.6));
      const displayText = fullColumnText.length > maxChars ? 
        fullColumnText.substring(0, maxChars - 3) + '...' : fullColumnText;
      
      // Add connection point marker for foreign key columns
      if (isFK) {
        // Add a small connection point indicator
        svg += `    <circle cx="${pos.x + tableWidth - 8}" cy="${columnY - 6}" r="2" fill="${this.colors.foreignKey}" opacity="0.6" class="fk-connection-point"/>\n`;
      }
      
      // Add connection point marker for primary key columns that are referenced
      if (isPK && this.isColumnReferenced(table, column.name)) {
        svg += `    <circle cx="${pos.x + 4}" cy="${columnY - 6}" r="2" fill="${this.colors.primaryKey}" opacity="0.6" class="pk-connection-point"/>\n`;
      }
      
      svg += `    <text x="${pos.x + 12}" y="${columnY}" class="${columnClass}">${displayText}</text>\n`;
      columnY += this.options.columnHeight;
    }

    // Show truncation indicator
    if (hasMore) {
      const remaining = table.columns.length - this.options.maxColumns;
      svg += `    <text x="${pos.x + 12}" y="${columnY}" class="column-text" style="font-style: italic; fill: #999;">... and ${remaining} more columns</text>\n`;
    }

    svg += '  </g>\n';
    return svg;
  }

  // Check if a column is referenced by any foreign key
  isColumnReferenced(table, columnName) {
    return this.relationships.some(rel => {
      const toTableMatch = this.tables.find(t => 
        t.displayName === rel.toTable || 
        t.fullName === rel.toTable ||
        t.name === rel.toTable
      );
      return toTableMatch === table && rel.toColumn === columnName;
    });
  }

  simplifyDataType(type) {
    // Simplify common data types for better readability
    return type
      .replace(/VARCHAR\((\d+)\)/i, 'VARCHAR($1)')
      .replace(/DECIMAL\((\d+),(\d+)\)/i, 'DECIMAL($1,$2)')
      .replace(/TIMESTAMP.*/, 'TIMESTAMP')
      .replace(/DATETIME.*/, 'DATETIME')
      .toUpperCase()
      .substring(0, 15); // Limit length
  }

  drawRelationship(relationship) {
    // For MSSQL with schemas, we need to find the table by its display name
    const findTablePosition = (tableName) => {
      // First try direct lookup
      if (this.tablePositions.has(tableName)) {
        return this.tablePositions.get(tableName);
      }
      
      // Try to find by extracting just the table name part (after last dot)
      const simpleName = tableName.includes('.') ? tableName.split('.').pop() : tableName;
      if (this.tablePositions.has(simpleName)) {
        return this.tablePositions.get(simpleName);
      }
      
      // Try to find by matching display name
      for (const table of this.tables) {
        if (table.displayName === tableName || table.fullName === tableName) {
          return this.tablePositions.get(table.name);
        }
      }
      
      return null;
    };

    const findTable = (tableName) => {
      // Find the actual table object to get its width
      const simpleName = tableName.includes('.') ? tableName.split('.').pop() : tableName;
      return this.tables.find(t => 
        t.name === simpleName || 
        t.displayName === tableName || 
        t.fullName === tableName
      );
    };

    const fromTable = findTable(relationship.fromTable);
    const toTable = findTable(relationship.toTable);

    if (!fromTable || !toTable) {
      return `<!-- Relationship ${relationship.fromTable} -> ${relationship.toTable}: table not found -->\n`;
    }

    // Get connection information including table edge points and routing points
    const fromRect = this.getTableRect(fromTable);
    const toRect = this.getTableRect(toTable);
    
    if (!fromRect || !toRect) return '';

    const connectionPoints = this.findBestConnectionPoints(
      fromRect, 
      toRect, 
      relationship.fromColumn, 
      relationship.toColumn, 
      fromTable, 
      toTable
    );

    // Generate smart path that connects specific columns
    const routingPath = this.generateSmartPath(
      fromTable, 
      toTable, 
      relationship.fromColumn, 
      relationship.toColumn
    );
    
    if (!routingPath || routingPath.length < 2) {
      return `<!-- Relationship ${relationship.fromTable} -> ${relationship.toTable}: could not generate path -->\n`;
    }

    // Create complete path: table edge -> routing start -> routing path -> routing end -> table edge
    const completePath = [];
    
    // Add connection from table edge to routing start
    if (connectionPoints.tableStart) {
      completePath.push(connectionPoints.tableStart);
    }
    
    // Add the routing path
    completePath.push(...routingPath);
    
    // Add connection from routing end to table edge  
    if (connectionPoints.tableEnd) {
      completePath.push(connectionPoints.tableEnd);
    }

    // Create smooth curved path
    const pathData = this.createSmoothPath(completePath);
    
    // Find midpoint for label
    const midIndex = Math.floor(routingPath.length / 2);
    const midPoint = routingPath[midIndex];

    // Connection indicators at table edges
    const tableStartPoint = connectionPoints.tableStart || routingPath[0];
    const tableEndPoint = connectionPoints.tableEnd || routingPath[routingPath.length - 1];

    let debugSvg = '';
    if (this.options.debugPaths) {
      // Add debug waypoints for routing path
      for (let i = 0; i < routingPath.length; i++) {
        const point = routingPath[i];
        debugSvg += `<circle cx="${point.x}" cy="${point.y}" r="4" fill="orange" opacity="0.7" stroke="red" stroke-width="1"/>`;
        debugSvg += `<text x="${point.x + 5}" y="${point.y - 5}" font-family="Arial" font-size="10" fill="red">R${i}</text>`;
      }
      
      debugSvg += this.generateDebugVisualization(fromTable, toTable);
    }

    return `
  <!-- Relationship: ${relationship.fromTable}.${relationship.fromColumn} -> ${relationship.toTable}.${relationship.toColumn} -->
  
  ${debugSvg}
  
  <!-- Connection indicators at table edges -->
  <circle cx="${tableStartPoint.x}" cy="${tableStartPoint.y}" r="3" fill="${this.colors.foreignKey}" opacity="0.8"/>
  <circle cx="${tableEndPoint.x}" cy="${tableEndPoint.y}" r="3" fill="${this.colors.primaryKey}" opacity="0.8"/>
  
  <!-- Relationship path -->
  <path d="${pathData}" class="relationship-line"/>
  
  <!-- Relationship label with background -->
  <rect x="${midPoint.x - 30}" y="${midPoint.y - 16}" width="60" height="12" 
        fill="white" stroke="${this.colors.relationship}" stroke-width="0.5" 
        rx="6" opacity="0.9"/>
  <text x="${midPoint.x}" y="${midPoint.y - 8}" 
        text-anchor="middle" 
        font-family="Arial, sans-serif" 
        font-size="9" 
        fill="${this.colors.relationship}">${this.truncateConstraintName(relationship.constraintName || '')}</text>
`;
  }

  // Truncate long constraint names for better display
  truncateConstraintName(name) {
    if (name.length > 12) {
      return name.substring(0, 9) + '...';
    }
    return name;
  }

  // Generate a smart path that routes around obstacles and connects specific columns
  generateSmartPath(fromTable, toTable, fromColumn, toColumn) {
    const fromRect = this.getTableRect(fromTable);
    const toRect = this.getTableRect(toTable);
    
    if (!fromRect || !toRect) return null;

    // Find best connection points for the specific columns
    const connectionPoints = this.findBestConnectionPoints(
      fromRect, 
      toRect, 
      fromColumn, 
      toColumn, 
      fromTable, 
      toTable
    );
    const startPoint = connectionPoints.start;
    const endPoint = connectionPoints.end;
    
    // Use simple and reliable routing
    return this.createSimpleRoute(startPoint, endPoint, fromTable, toTable);
  }

  // Simple, reliable routing that uses the canvas margins for safe paths
  createSimpleRoute(start, end, fromTable, toTable) {
    // Try simple L-shaped routes first
    const simpleRoutes = [
      // Horizontal first, then vertical
      [start, { x: end.x, y: start.y }, end],
      // Vertical first, then horizontal  
      [start, { x: start.x, y: end.y }, end]
    ];

    // Check if any simple route is clear
    for (const route of simpleRoutes) {
      if (this.isRouteClear(route, fromTable, toTable)) {
        return route;
      }
    }

    // If simple routes are blocked, use margin routing
    return this.createMarginRoute(start, end);
  }

  // Check if a route is clear of obstacles
  isRouteClear(waypoints, fromTable, toTable) {
    // Get obstacle rectangles (all tables except source and destination)
    const obstacles = this.tables
      .filter(table => table !== fromTable && table !== toTable)
      .map(table => this.getTableRect(table))
      .filter(rect => rect);

    // Check each segment of the route
    for (let i = 0; i < waypoints.length - 1; i++) {
      const segmentStart = waypoints[i];
      const segmentEnd = waypoints[i + 1];
      
      // Check if this segment intersects any obstacle
      for (const obstacle of obstacles) {
        if (this.lineIntersectsRectSimple(segmentStart, segmentEnd, obstacle)) {
          return false;
        }
      }
    }
    
    return true;
  }

  // Simple line-rectangle intersection (with buffer)
  lineIntersectsRectSimple(start, end, rect) {
    const collisionBuffer = this.options.collisionBuffer; // For collision detection
    const visualBuffer = this.options.visualBuffer; // Additional visual margin for better appearance
    const totalBuffer = collisionBuffer + visualBuffer;
    
    const expandedRect = {
      x: rect.x - totalBuffer,
      y: rect.y - totalBuffer,
      right: rect.right + totalBuffer,
      bottom: rect.bottom + totalBuffer
    };

    // Check if line passes through the expanded rectangle
    return this.lineIntersectsBox(start, end, expandedRect);
  }

  // Basic line-box intersection test
  lineIntersectsBox(start, end, box) {
    // If both points are on the same side of any box edge, no intersection
    if ((start.x < box.x && end.x < box.x) || // Both left
        (start.x > box.right && end.x > box.right) || // Both right
        (start.y < box.y && end.y < box.y) || // Both above
        (start.y > box.bottom && end.y > box.bottom)) { // Both below
      return false;
    }

    // If either point is inside the box, there's an intersection
    if ((start.x >= box.x && start.x <= box.right && start.y >= box.y && start.y <= box.bottom) ||
        (end.x >= box.x && end.x <= box.right && end.y >= box.y && end.y <= box.bottom)) {
      return true;
    }

    // Check if line crosses any edge of the box
    const edges = [
      { start: { x: box.x, y: box.y }, end: { x: box.right, y: box.y } }, // top
      { start: { x: box.right, y: box.y }, end: { x: box.right, y: box.bottom } }, // right
      { start: { x: box.right, y: box.bottom }, end: { x: box.x, y: box.bottom } }, // bottom
      { start: { x: box.x, y: box.bottom }, end: { x: box.x, y: box.y } } // left
    ];

    return edges.some(edge => this.linesIntersectSimple(start, end, edge.start, edge.end));
  }

  // Simple line intersection test
  linesIntersectSimple(line1Start, line1End, line2Start, line2End) {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(line1Start, line2Start, line2End) !== ccw(line1End, line2Start, line2End) &&
           ccw(line1Start, line1End, line2Start) !== ccw(line1Start, line1End, line2End);
  }

  // Create a route using the safe margin areas
  createMarginRoute(start, end) {
    const bounds = this.calculateCanvasBounds();
    const safeZone = this.options.canvasMargin - this.options.safeZoneOffset; // Safe routing zone in margins
    
    // Determine best margin routing based on positions
    const startLeft = start.x < bounds.width / 2;
    const endLeft = end.x < bounds.width / 2;
    const startTop = start.y < bounds.height / 2;
    const endTop = end.y < bounds.height / 2;

    // Route around the appropriate margin with configurable spacing
    if (startLeft && !endLeft) {
      // Left to right - route around top or bottom
      const routeY = startTop ? 
        safeZone + this.options.routingSpacingTop : 
        bounds.height - safeZone - this.options.routingSpacingTop;
      return [start, { x: start.x, y: routeY }, { x: end.x, y: routeY }, end];
    } else if (!startLeft && endLeft) {
      // Right to left - route around top or bottom
      const routeY = startTop ? 
        safeZone + this.options.routingSpacingTop : 
        bounds.height - safeZone - this.options.routingSpacingTop;
      return [start, { x: start.x, y: routeY }, { x: end.x, y: routeY }, end];
    } else if (startTop && !endTop) {
      // Top to bottom - route around left or right
      const routeX = startLeft ? 
        safeZone + this.options.routingSpacingSide : 
        bounds.width - safeZone - this.options.routingSpacingSide;
      return [start, { x: routeX, y: start.y }, { x: routeX, y: end.y }, end];
    } else if (!startTop && endTop) {
      // Bottom to top - route around left or right
      const routeX = startLeft ? 
        safeZone + this.options.routingSpacingSide : 
        bounds.width - safeZone - this.options.routingSpacingSide;
      return [start, { x: routeX, y: start.y }, { x: routeX, y: end.y }, end];
    } else {
      // Same quadrant - use top margin as safe route with good spacing
      return [start, 
        { x: start.x, y: safeZone + this.options.routingSpacingTop }, 
        { x: end.x, y: safeZone + this.options.routingSpacingTop }, 
        end];
    }
  }

  // Check if direct path intersects any obstacles
  isDirectPathClear(start, end, obstacles) {
    for (const obstacle of obstacles) {
      if (this.lineIntersectsRectangle(start, end, obstacle)) {
        return false;
      }
    }
    return true;
  }

  // More robust line-rectangle intersection
  lineIntersectsRectangle(lineStart, lineEnd, rect) {
    // Check if line intersects any of the four rectangle sides
    const rectLines = [
      { start: { x: rect.x, y: rect.y }, end: { x: rect.right, y: rect.y } }, // top
      { start: { x: rect.right, y: rect.y }, end: { x: rect.right, y: rect.bottom } }, // right
      { start: { x: rect.right, y: rect.bottom }, end: { x: rect.x, y: rect.bottom } }, // bottom
      { start: { x: rect.x, y: rect.bottom }, end: { x: rect.x, y: rect.y } } // left
    ];

    return rectLines.some(rectLine => 
      this.linesIntersect(lineStart, lineEnd, rectLine.start, rectLine.end)
    );
  }

  // Robust line-line intersection test
  linesIntersect(p1, q1, p2, q2) {
    const orientation = (p, q, r) => {
      const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
      if (val === 0) return 0; // colinear
      return (val > 0) ? 1 : 2; // clockwise or counterclockwise
    };

    const onSegment = (p, q, r) => {
      return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
             q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    };

    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);

    // General case
    if (o1 !== o2 && o3 !== o4) return true;

    // Special cases
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;

    return false;
  }

  // Create Manhattan-style path (orthogonal routing)
  createManhattanPath(start, end, obstacles) {
    const waypoints = [start];
    
    // Try different routing strategies
    const strategies = [
      () => this.tryHorizontalFirst(start, end, obstacles),
      () => this.tryVerticalFirst(start, end, obstacles),
      () => this.tryPerimeterRouting(start, end, obstacles),
      () => this.tryCornerRouting(start, end, obstacles)
    ];

    for (const strategy of strategies) {
      const path = strategy();
      if (path && this.validatePath(path, obstacles)) {
        return path;
      }
    }

    // If all strategies fail, use safe perimeter routing
    return this.createSafePerimeterPath(start, end);
  }

  // Strategy 1: Horizontal first (go horizontal, then vertical)
  tryHorizontalFirst(start, end, obstacles) {
    const waypoints = [start];
    
    // Go horizontal first
    const horizontalPoint = { x: end.x, y: start.y };
    waypoints.push(horizontalPoint);
    waypoints.push(end);

    return waypoints;
  }

  // Strategy 2: Vertical first (go vertical, then horizontal)
  tryVerticalFirst(start, end, obstacles) {
    const waypoints = [start];
    
    // Go vertical first
    const verticalPoint = { x: start.x, y: end.y };
    waypoints.push(verticalPoint);
    waypoints.push(end);

    return waypoints;
  }

  // Strategy 3: Route around the perimeter of obstacles
  tryPerimeterRouting(start, end, obstacles) {
    const bounds = this.calculateCanvasBounds();
    const safeMargin = 60; // Safe margin from canvas edges
    
    // Find the best perimeter path
    const paths = [
      // Top route
      [
        start,
        { x: start.x, y: safeMargin + 80 }, // Extra space for header
        { x: end.x, y: safeMargin + 80 },
        end
      ],
      // Bottom route
      [
        start,
        { x: start.x, y: bounds.height - safeMargin },
        { x: end.x, y: bounds.height - safeMargin },
        end
      ],
      // Left route
      [
        start,
        { x: safeMargin, y: start.y },
        { x: safeMargin, y: end.y },
        end
      ],
      // Right route
      [
        start,
        { x: bounds.width - safeMargin, y: start.y },
        { x: bounds.width - safeMargin, y: end.y },
        end
      ]
    ];

    // Return the first valid path
    for (const path of paths) {
      if (this.validatePath(path, obstacles)) {
        return path;
      }
    }

    return null;
  }

  // Strategy 4: Route around corners of blocking obstacles
  tryCornerRouting(start, end, obstacles) {
    // Find obstacles that are directly blocking the path
    const blockingObstacles = obstacles.filter(obstacle => 
      this.lineIntersectsRectangle(start, end, obstacle)
    );

    if (blockingObstacles.length === 0) {
      return [start, end];
    }

    // Try routing around the first blocking obstacle
    const obstacle = blockingObstacles[0];
    const buffer = 20;
    
    // Calculate corner points
    const corners = [
      { x: obstacle.x - buffer, y: obstacle.y - buffer }, // top-left
      { x: obstacle.right + buffer, y: obstacle.y - buffer }, // top-right
      { x: obstacle.right + buffer, y: obstacle.bottom + buffer }, // bottom-right
      { x: obstacle.x - buffer, y: obstacle.bottom + buffer } // bottom-left
    ];

    // Find the best corner to route through
    let bestPath = null;
    let bestDistance = Infinity;

    for (const corner of corners) {
      const path = [start, corner, end];
      const distance = this.calculatePathLength(path);
      
      if (distance < bestDistance && this.validatePath(path, obstacles)) {
        bestPath = path;
        bestDistance = distance;
      }
    }

    return bestPath;
  }

  // Validate that a path doesn't intersect any obstacles
  validatePath(waypoints, obstacles) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const segmentStart = waypoints[i];
      const segmentEnd = waypoints[i + 1];
      
      for (const obstacle of obstacles) {
        if (this.lineIntersectsRectangle(segmentStart, segmentEnd, obstacle)) {
          return false;
        }
      }
    }
    return true;
  }

  // Calculate total path length
  calculatePathLength(waypoints) {
    let length = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const dx = waypoints[i + 1].x - waypoints[i].x;
      const dy = waypoints[i + 1].y - waypoints[i].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  // Safe fallback: route around the entire canvas perimeter
  createSafePerimeterPath(start, end) {
    const bounds = this.calculateCanvasBounds();
    const safeMargin = 80; // Large safe margin
    
    // Always route around the top and right edges for maximum safety
    return [
      start,
      { x: start.x, y: safeMargin + 80 }, // Extra space for header
      { x: bounds.width - safeMargin, y: safeMargin + 80 },
      { x: bounds.width - safeMargin, y: end.y },
      end
    ];
  }

  // Get rectangle bounds for a table
  getTableRect(table) {
    const pos = this.tablePositions.get(table.name);
    if (!pos) return null;
    
    const width = this.getTableWidth(table);
    const height = this.getTableHeight(table);
    
    return {
      x: pos.x,
      y: pos.y,
      width: width,
      height: height,
      right: pos.x + width,
      bottom: pos.y + height,
      centerX: pos.x + width / 2,
      centerY: pos.y + height / 2
    };
  }

  // Find the best connection points on table edges, considering specific columns
  findBestConnectionPoints(fromRect, toRect, fromColumn, toColumn, fromTable, toTable) {
    // Calculate Y positions for specific columns
    const fromColumnY = this.getColumnYPosition(fromTable, fromColumn);
    const toColumnY = this.getColumnYPosition(toTable, toColumn);
    
    // Add margin from table edges before lines can turn
    const connectionMargin = this.options.connectionMargin;
    
    // Calculate potential connection points on each side, using column-specific Y positions
    const fromPoints = {
      right: { x: fromRect.right + connectionMargin, y: fromColumnY },
      left: { x: fromRect.x - connectionMargin, y: fromColumnY },
      top: { x: fromRect.centerX, y: fromRect.y - connectionMargin },
      bottom: { x: fromRect.centerX, y: fromRect.bottom + connectionMargin }
    };
    
    const toPoints = {
      right: { x: toRect.right + connectionMargin, y: toColumnY },
      left: { x: toRect.x - connectionMargin, y: toColumnY },
      top: { x: toRect.centerX, y: toRect.y - connectionMargin },
      bottom: { x: toRect.centerX, y: toRect.bottom + connectionMargin }
    };

    // Find the shortest valid connection, with preference for column-aligned connections
    let bestDistance = Infinity;
    let bestConnection = null;
    
    for (const [fromSide, fromPoint] of Object.entries(fromPoints)) {
      for (const [toSide, toPoint] of Object.entries(toPoints)) {
        const distance = this.distance(fromPoint, toPoint);
        
        // Strongly prefer horizontal connections when using column positions
        let weight = distance;
        if ((fromSide === 'right' && toSide === 'left') || (fromSide === 'left' && toSide === 'right')) {
          weight *= 0.6; // Strong preference for horizontal column-to-column
        } else if (fromSide === 'left' || fromSide === 'right' || toSide === 'left' || toSide === 'right') {
          weight *= 0.8; // Some preference for side connections
        }
        
        if (weight < bestDistance) {
          bestDistance = weight;
          bestConnection = { 
            start: fromPoint, 
            end: toPoint, 
            fromSide, 
            toSide,
            // Store actual connection points on table edges (without margin)
            tableStart: { x: fromSide === 'right' ? fromRect.right : fromSide === 'left' ? fromRect.x : fromRect.centerX, y: fromColumnY },
            tableEnd: { x: toSide === 'right' ? toRect.right : toSide === 'left' ? toRect.x : toRect.centerX, y: toColumnY }
          };
        }
      }
    }
    
    return bestConnection || { 
      start: { x: fromRect.right + connectionMargin, y: fromColumnY }, 
      end: { x: toRect.x - connectionMargin, y: toColumnY },
      fromSide: 'right',
      toSide: 'left',
      tableStart: { x: fromRect.right, y: fromColumnY },
      tableEnd: { x: toRect.x, y: toColumnY }
    };
  }

  // Get the Y position of a specific column within a table
  getColumnYPosition(table, columnName) {
    const rect = this.getTableRect(table);
    if (!rect) return rect ? rect.centerY : 0;
    
    const visibleColumns = table.columns.slice(0, this.options.maxColumns);
    const columnIndex = visibleColumns.findIndex(col => col.name === columnName);
    
    if (columnIndex === -1) {
      // Column not found in visible columns, return center
      return rect.centerY;
    }
    
    // Calculate Y position: header height + column index * column height + half column height
    const columnY = rect.y + this.options.tableHeaderHeight + 
                   (columnIndex * this.options.columnHeight) + 
                   (this.options.columnHeight / 2) + 
                   9; // Small offset for text positioning
    
    return columnY;
  }

  // Check if a straight line path is clear of obstacles
  isPathClear(start, end, excludeRects = []) {
    const obstacles = this.tables
      .map(table => this.getTableRect(table))
      .filter(rect => rect && !excludeRects.includes(rect));
    
    return !obstacles.some(rect => this.lineIntersectsRect(start, end, rect));
  }

  // Check if a line intersects with a rectangle (legacy method, keeping for compatibility)
  lineIntersectsRect(start, end, rect) {
    // Add small buffer around rectangle
    const buffer = 10;
    const expandedRect = {
      x: rect.x - buffer,
      y: rect.y - buffer,
      right: rect.right + buffer,
      bottom: rect.bottom + buffer
    };
    
    return this.lineIntersectsRectangle(start, end, expandedRect);
  }

  // Route around obstacles using a more sophisticated algorithm
  routeAroundObstacles(start, end, fromRect, toRect) {
    // Use A* pathfinding on a grid to find optimal path
    return this.findPathWithAStar(start, end, [fromRect, toRect]);
  }

  // A* pathfinding algorithm for obstacle avoidance
  findPathWithAStar(start, end, excludeRects = []) {
    const gridSize = 20; // Grid resolution
    const buffer = 25; // Buffer around obstacles
    
    // Get all obstacles (all tables except source/destination)
    const obstacles = this.tables
      .map(table => this.getTableRect(table))
      .filter(rect => rect && !excludeRects.includes(rect))
      .map(rect => ({
        x: rect.x - buffer,
        y: rect.y - buffer,
        right: rect.right + buffer,
        bottom: rect.bottom + buffer
      }));

    // Create grid bounds
    const bounds = this.calculateCanvasBounds();
    const gridWidth = Math.ceil(bounds.width / gridSize);
    const gridHeight = Math.ceil(bounds.height / gridSize);

    // Convert points to grid coordinates
    const startGrid = {
      x: Math.floor(start.x / gridSize),
      y: Math.floor(start.y / gridSize)
    };
    
    const endGrid = {
      x: Math.floor(end.x / gridSize),
      y: Math.floor(end.y / gridSize)
    };

    // Check if a grid cell is blocked by obstacles
    const isBlocked = (gx, gy) => {
      const x = gx * gridSize;
      const y = gy * gridSize;
      
      return obstacles.some(obstacle => 
        x >= obstacle.x && x <= obstacle.right &&
        y >= obstacle.y && y <= obstacle.bottom
      );
    };

    // A* implementation
    const openSet = [startGrid];
    const closedSet = new Set();
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    
    const getKey = (node) => `${node.x},${node.y}`;
    
    gScore.set(getKey(startGrid), 0);
    fScore.set(getKey(startGrid), this.heuristic(startGrid, endGrid));

    while (openSet.length > 0) {
      // Get node with lowest fScore
      openSet.sort((a, b) => 
        (fScore.get(getKey(a)) || Infinity) - (fScore.get(getKey(b)) || Infinity)
      );
      
      const current = openSet.shift();
      const currentKey = getKey(current);
      
      if (current.x === endGrid.x && current.y === endGrid.y) {
        // Path found, reconstruct it
        return this.reconstructPath(cameFrom, current, gridSize, start, end);
      }
      
      closedSet.add(currentKey);
      
      // Check all neighbors (8-directional)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          
          const neighbor = {
            x: current.x + dx,
            y: current.y + dy
          };
          
          const neighborKey = getKey(neighbor);
          
          // Skip if out of bounds or already processed
          if (neighbor.x < 0 || neighbor.x >= gridWidth ||
              neighbor.y < 0 || neighbor.y >= gridHeight ||
              closedSet.has(neighborKey)) {
            continue;
          }
          
          // Skip if blocked by obstacle
          if (isBlocked(neighbor.x, neighbor.y)) {
            continue;
          }
          
          // Calculate tentative gScore
          const diagonal = dx !== 0 && dy !== 0;
          const moveCost = diagonal ? Math.sqrt(2) : 1;
          const tentativeGScore = (gScore.get(currentKey) || Infinity) + moveCost;
          
          if (!openSet.some(node => node.x === neighbor.x && node.y === neighbor.y)) {
            openSet.push(neighbor);
          } else if (tentativeGScore >= (gScore.get(neighborKey) || Infinity)) {
            continue;
          }
          
          // This path is the best until now
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);
          fScore.set(neighborKey, tentativeGScore + this.heuristic(neighbor, endGrid));
        }
      }
    }
    
    // No path found, fall back to simple routing
    return this.fallbackSimpleRoute(start, end);
  }

  // Manhattan distance heuristic for A*
  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  // Reconstruct path from A* result
  reconstructPath(cameFrom, current, gridSize, start, end) {
    const path = [];
    const getKey = (node) => `${node.x},${node.y}`;
    
    // Add actual end point
    path.unshift(end);
    
    // Reconstruct path from grid
    while (cameFrom.has(getKey(current))) {
      const realPoint = {
        x: current.x * gridSize,
        y: current.y * gridSize
      };
      path.unshift(realPoint);
      current = cameFrom.get(getKey(current));
    }
    
    // Add actual start point
    path.unshift(start);
    
    // Simplify path by removing redundant waypoints
    return this.simplifyPath(path);
  }

  // Simplify path by removing unnecessary waypoints
  simplifyPath(path) {
    if (path.length <= 2) return path;
    
    const simplified = [path[0]]; // Always keep start point
    
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const next = path[i + 1];
      
      // Calculate directions
      const dir1 = {
        x: current.x - prev.x,
        y: current.y - prev.y
      };
      const dir2 = {
        x: next.x - current.x,
        y: next.y - current.y
      };
      
      // Normalize directions
      const normalize = (d) => {
        const len = Math.sqrt(d.x * d.x + d.y * d.y);
        return len > 0 ? { x: d.x / len, y: d.y / len } : { x: 0, y: 0 };
      };
      
      const ndir1 = normalize(dir1);
      const ndir2 = normalize(dir2);
      
      // Keep point if direction changes significantly
      const dotProduct = ndir1.x * ndir2.x + ndir1.y * ndir2.y;
      if (dotProduct < 0.95) { // Angle threshold
        simplified.push(current);
      }
    }
    
    simplified.push(path[path.length - 1]); // Always keep end point
    
    return simplified;
  }

  // Fallback simple routing when A* fails
  fallbackSimpleRoute(start, end) {
    const waypoints = [start];
    const buffer = 30;
    
    // Create a simple L-shaped path that tries to avoid the center of the canvas
    const bounds = this.calculateCanvasBounds();
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    
    // Decide routing preference based on position relative to center
    const startFromLeft = start.x < centerX;
    const endToLeft = end.x < centerX;
    const startFromTop = start.y < centerY;
    const endToTop = end.y < centerY;
    
    if (startFromLeft !== endToLeft) {
      // Crossing horizontally - route around edges
      const routeY = startFromTop ? bounds.height * 0.1 : bounds.height * 0.9;
      waypoints.push({ x: start.x, y: routeY });
      waypoints.push({ x: end.x, y: routeY });
    } else if (startFromTop !== endToTop) {
      // Crossing vertically - route around edges  
      const routeX = startFromLeft ? bounds.width * 0.1 : bounds.width * 0.9;
      waypoints.push({ x: routeX, y: start.y });
      waypoints.push({ x: routeX, y: end.y });
    } else {
      // Same quadrant - simple L-shape
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      
      if (Math.abs(end.x - start.x) > Math.abs(end.y - start.y)) {
        waypoints.push({ x: midX, y: start.y });
        waypoints.push({ x: midX, y: end.y });
      } else {
        waypoints.push({ x: start.x, y: midY });
        waypoints.push({ x: end.x, y: midY });
      }
    }
    
    waypoints.push(end);
    return waypoints;
  }

  // Create smooth curved path from waypoints
  createSmoothPath(waypoints) {
    if (waypoints.length < 2) return '';
    
    const radius = 15; // Corner radius for smooth curves
    let pathData = `M ${waypoints[0].x},${waypoints[0].y}`;
    
    for (let i = 1; i < waypoints.length; i++) {
      const current = waypoints[i];
      const previous = waypoints[i - 1];
      
      if (i === waypoints.length - 1) {
        // Last segment - draw to end point with arrow
        pathData += ` L ${current.x},${current.y}`;
        
        // Add arrowhead
        const angle = Math.atan2(current.y - previous.y, current.x - previous.x);
        const arrowLength = 8;
        const arrowWidth = 5;
        
        const arrowX1 = current.x - arrowLength * Math.cos(angle - Math.PI / 6);
        const arrowY1 = current.y - arrowLength * Math.sin(angle - Math.PI / 6);
        const arrowX2 = current.x - arrowLength * Math.cos(angle + Math.PI / 6);
        const arrowY2 = current.y - arrowLength * Math.sin(angle + Math.PI / 6);
        
        pathData += ` M ${current.x},${current.y} L ${arrowX1},${arrowY1} M ${current.x},${current.y} L ${arrowX2},${arrowY2}`;
      } else {
        // Middle segments - create smooth corners
        const next = waypoints[i + 1];
        
        // Calculate direction vectors
        const d1x = current.x - previous.x;
        const d1y = current.y - previous.y;
        const d2x = next.x - current.x;
        const d2y = next.y - current.y;
        
        // Normalize distances
        const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
        const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
        
        if (len1 > 0 && len2 > 0) {
          const adjustedRadius = Math.min(radius, len1 / 2, len2 / 2);
          
          // Points for smooth curve
          const beforeX = current.x - (d1x / len1) * adjustedRadius;
          const beforeY = current.y - (d1y / len1) * adjustedRadius;
          const afterX = current.x + (d2x / len2) * adjustedRadius;
          const afterY = current.y + (d2y / len2) * adjustedRadius;
          
          pathData += ` L ${beforeX},${beforeY} Q ${current.x},${current.y} ${afterX},${afterY}`;
        } else {
          pathData += ` L ${current.x},${current.y}`;
        }
      }
    }
    
    return pathData;
  }

  // Generate debug visualization for routing
  generateDebugVisualization(fromTable, toTable) {
    const bounds = this.calculateCanvasBounds();
    const safeZone = this.options.canvasMargin - this.options.safeZoneOffset;
    let debugSvg = '';
    
    // Show the safe routing zones (canvas margins)
    // Top safe zone (with configurable spacing)
    const topRouteY = safeZone + this.options.routingSpacingTop;
    debugSvg += `<rect x="0" y="${topRouteY - 10}" width="${bounds.width}" height="20" 
                       fill="green" opacity="0.2" stroke="green" stroke-width="2" stroke-dasharray="10,5"/>`;
    debugSvg += `<text x="10" y="${topRouteY + 5}" font-family="Arial" font-size="12" fill="green" font-weight="bold">Primary Routing Zone</text>`;
    
    // Bottom safe zone (with configurable spacing)
    const bottomRouteY = bounds.height - safeZone - this.options.routingSpacingTop;
    debugSvg += `<rect x="0" y="${bottomRouteY - 10}" width="${bounds.width}" height="20" 
                       fill="green" opacity="0.2" stroke="green" stroke-width="2" stroke-dasharray="10,5"/>`;
    
    // Left safe zone (with configurable spacing)
    const leftRouteX = safeZone + this.options.routingSpacingSide;
    debugSvg += `<rect x="${leftRouteX - 10}" y="0" width="20" height="${bounds.height}" 
                       fill="green" opacity="0.2" stroke="green" stroke-width="2" stroke-dasharray="10,5"/>`;
    
    // Right safe zone (with configurable spacing)
    const rightRouteX = bounds.width - safeZone - this.options.routingSpacingSide;
    debugSvg += `<rect x="${rightRouteX - 10}" y="0" width="20" height="${bounds.height}" 
                       fill="green" opacity="0.2" stroke="green" stroke-width="2" stroke-dasharray="10,5"/>`;
    
    // Show table buffer zones
    const obstacles = this.getObstacles(fromTable, toTable);
      
    obstacles.forEach((obstacle, index) => {
      const collisionBuffer = this.options.collisionBuffer;
      const visualBuffer = this.options.visualBuffer;
      
      // Show collision buffer (red)
      debugSvg += `<rect x="${obstacle.x - collisionBuffer}" y="${obstacle.y - collisionBuffer}" 
                         width="${obstacle.right - obstacle.x + 2 * collisionBuffer}" 
                         height="${obstacle.bottom - obstacle.y + 2 * collisionBuffer}" 
                         fill="red" opacity="0.15" stroke="red" stroke-width="1" stroke-dasharray="5,5"/>`;
      
      // Show visual buffer (orange)  
      debugSvg += `<rect x="${obstacle.x - collisionBuffer - visualBuffer}" y="${obstacle.y - collisionBuffer - visualBuffer}" 
                         width="${obstacle.right - obstacle.x + 2 * (collisionBuffer + visualBuffer)}" 
                         height="${obstacle.bottom - obstacle.y + 2 * (collisionBuffer + visualBuffer)}" 
                         fill="orange" opacity="0.1" stroke="orange" stroke-width="1" stroke-dasharray="3,3"/>`;
    });
    
    // Add legend for debug zones with current values
    debugSvg += `<text x="10" y="${bounds.height - 80}" font-family="Arial" font-size="11" fill="red">Red: Collision Buffer (${this.options.collisionBuffer}px)</text>`;
    debugSvg += `<text x="10" y="${bounds.height - 65}" font-family="Arial" font-size="11" fill="orange">Orange: Visual Buffer (${this.options.visualBuffer}px)</text>`;
    debugSvg += `<text x="10" y="${bounds.height - 50}" font-family="Arial" font-size="11" fill="green">Green: Safe Routing Zones</text>`;
    debugSvg += `<text x="10" y="${bounds.height - 35}" font-family="Arial" font-size="11" fill="blue">Connection Margin: ${this.options.connectionMargin}px</text>`;
    debugSvg += `<text x="10" y="${bounds.height - 20}" font-family="Arial" font-size="11" fill="purple">Canvas Margin: ${this.options.canvasMargin}px</text>`;
    
    return debugSvg;
  }

  // Calculate distance between two points (using DiagramMath)
  distance(p1, p2) {
    return this.math.distance(p1, p2);
  }

  drawTitle() {
    const titleY = this.options.canvasMargin - 20;
    return `
  <!-- Diagram title -->
  <text x="50%" y="${titleY}" class="title-text">Database Structure Diagram</text>
  <text x="50%" y="${titleY + 20}" 
        text-anchor="middle"
        font-family="Arial, sans-serif" 
        font-size="12" 
        fill="#666">${this.tables.length} tables, ${this.relationships.length} relationships</text>
`;
  }

  drawLegend(svgWidth, svgHeight) {
    const legendX = svgWidth - 220;
    const legendY = svgHeight - 100;

    return `
  <!-- Legend -->
  <g id="legend">
    <rect x="${legendX - 10}" y="${legendY - 5}" width="200" height="90" 
          fill="white" stroke="#ccc" stroke-width="1" rx="5" opacity="0.9"/>
    
    <text x="${legendX}" y="${legendY + 10}" class="legend-text" style="font-weight: bold;">Legend:</text>
    <text x="${legendX}" y="${legendY + 25}" class="legend-text">🔑 Primary Key</text>
    <text x="${legendX}" y="${legendY + 40}" class="legend-text">🔗 Foreign Key</text>
    
    <!-- Visual connection indicators -->
    <circle cx="${legendX + 5}" cy="${legendY + 50}" r="2" fill="${this.colors.foreignKey}" opacity="0.6"/>
    <text x="${legendX + 15}" y="${legendY + 55}" class="legend-text">FK Connection</text>
    
    <circle cx="${legendX + 5}" cy="${legendY + 65}" r="2" fill="${this.colors.primaryKey}" opacity="0.6"/>
    <text x="${legendX + 15}" y="${legendY + 70}" class="legend-text">PK Reference</text>
    
    <!-- Relationship line example -->
    <path d="M ${legendX + 120} ${legendY + 50} L ${legendX + 140} ${legendY + 50}" 
          stroke="${this.colors.relationship}" stroke-width="2" fill="none"/>
    <circle cx="${legendX + 120}" cy="${legendY + 50}" r="3" fill="${this.colors.foreignKey}" opacity="0.8"/>
    <circle cx="${legendX + 140}" cy="${legendY + 50}" r="3" fill="${this.colors.primaryKey}" opacity="0.8"/>
    <text x="${legendX + 150}" y="${legendY + 55}" class="legend-text">Relationship</text>
  </g>
`;
  }
}

module.exports = { SVGDiagramGenerator };