/**
 * Mathematical utility class for diagram generation and geometric calculations.
 * Provides methods for text measurement, collision detection, path routing, and curve generation.
 * Used primarily for creating entity relationship diagrams with proper spacing and routing.
 * 
 * @class DiagramMath
 * @example
 * const options = {
 *   collisionBuffer: 25,
 *   visualBuffer: 50,
 *   connectionMargin: 25,
 *   canvasMargin: 100,
 *   safeZoneOffset: 40,
 *   routingSpacingTop: 60,
 *   routingSpacingSide: 40
 * };
 * const math = new DiagramMath(options);
 */
class DiagramMath {
  /**
   * Creates a new DiagramMath instance with configuration options.
   * 
   * @param {Object} options - Configuration options for diagram calculations
   * @param {number} [options.collisionBuffer=25] - Buffer space for collision detection
   * @param {number} [options.visualBuffer=50] - Visual spacing buffer around elements
   * @param {number} [options.connectionMargin=25] - Margin for connection points
   * @param {number} [options.canvasMargin=100] - Canvas margin for routing
   * @param {number} [options.safeZoneOffset=40] - Offset for safe routing zones
   * @param {number} [options.routingSpacingTop=60] - Top routing spacing
   * @param {number} [options.routingSpacingSide=40] - Side routing spacing
   * 
   * @example
   * const math = new DiagramMath({
   *   collisionBuffer: 30,
   *   connectionMargin: 20
   * });
   */
  constructor(options) {
    /**
     * Configuration options for diagram calculations
     * @type {Object}
     */
    this.options = options;
  }

  /**
   * Estimates the pixel width of text based on font size.
   * Uses an approximation suitable for monospace-like fonts in SVG diagrams.
   * 
   * @param {string} text - The text to measure
   * @param {number} [fontSize=12] - Font size in pixels
   * @returns {number} Estimated text width in pixels
   * 
   * @example
   * const width = math.estimateTextWidth("Hello World", 14);
   * console.log(width); // Approximately 84 pixels
   * 
   * @example
   * // Measure column name for table layout
   * const columnWidth = math.estimateTextWidth("user_id", 12);
   */
  estimateTextWidth(text, fontSize = 12) {
    // Rough approximation: average character width in pixels
    const avgCharWidth = fontSize * 0.6; // Adjust this factor based on font
    return text.length * avgCharWidth;
  }

  /**
   * Calculates the Euclidean distance between two points.
   * 
   * @param {Object} p1 - First point
   * @param {number} p1.x - X coordinate of first point
   * @param {number} p1.y - Y coordinate of first point
   * @param {Object} p2 - Second point
   * @param {number} p2.x - X coordinate of second point
   * @param {number} p2.y - Y coordinate of second point
   * @returns {number} Distance between the two points
   * 
   * @example
   * const dist = math.distance({x: 0, y: 0}, {x: 3, y: 4});
   * console.log(dist); // 5 (3-4-5 triangle)
   * 
   * @example
   * // Find distance between table connection points
   * const connectionDistance = math.distance(startPoint, endPoint);
   */
  distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  /**
   * Calculates the total length of a path defined by waypoints.
   * Sums the distances between consecutive waypoints.
   * 
   * @param {Object[]} waypoints - Array of point objects representing the path
   * @param {number} waypoints[].x - X coordinate of waypoint
   * @param {number} waypoints[].y - Y coordinate of waypoint
   * @returns {number} Total path length in pixels
   * 
   * @example
   * const waypoints = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 20}];
   * const length = math.calculatePathLength(waypoints);
   * console.log(length); // 30 (10 + 20)
   * 
   * @example
   * // Calculate connection line length for optimization
   * const routeLength = math.calculatePathLength(connectionRoute);
   */
  calculatePathLength(waypoints) {
    let length = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const dx = waypoints[i + 1].x - waypoints[i].x;
      const dy = waypoints[i + 1].y - waypoints[i].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  /**
   * Tests if a line segment intersects with a rectangular box.
   * Uses efficient bounding box checks followed by edge intersection tests.
   * 
   * @param {Object} start - Starting point of the line
   * @param {number} start.x - X coordinate of line start
   * @param {number} start.y - Y coordinate of line start
   * @param {Object} end - Ending point of the line
   * @param {number} end.x - X coordinate of line end
   * @param {number} end.y - Y coordinate of line end
   * @param {Object} box - Rectangle to test intersection against
   * @param {number} box.x - Left edge of box
   * @param {number} box.y - Top edge of box
   * @param {number} box.right - Right edge of box
   * @param {number} box.bottom - Bottom edge of box
   * @returns {boolean} True if line intersects the box
   * 
   * @example
   * const line = {start: {x: 0, y: 0}, end: {x: 100, y: 100}};
   * const box = {x: 40, y: 40, right: 60, bottom: 60};
   * const intersects = math.lineIntersectsBox(line.start, line.end, box);
   * console.log(intersects); // true
   */
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

  /**
   * Tests if two line segments intersect using the counter-clockwise algorithm.
   * Efficient geometric test for line segment intersection.
   * 
   * @param {Object} line1Start - Start point of first line
   * @param {number} line1Start.x - X coordinate
   * @param {number} line1Start.y - Y coordinate
   * @param {Object} line1End - End point of first line
   * @param {number} line1End.x - X coordinate
   * @param {number} line1End.y - Y coordinate
   * @param {Object} line2Start - Start point of second line
   * @param {number} line2Start.x - X coordinate
   * @param {number} line2Start.y - Y coordinate
   * @param {Object} line2End - End point of second line
   * @param {number} line2End.x - X coordinate
   * @param {number} line2End.y - Y coordinate
   * @returns {boolean} True if the line segments intersect
   * 
   * @example
   * const intersects = math.linesIntersectSimple(
   *   {x: 0, y: 0}, {x: 10, y: 10},
   *   {x: 0, y: 10}, {x: 10, y: 0}
   * );
   * console.log(intersects); // true (X intersection)
   */
  linesIntersectSimple(line1Start, line1End, line2Start, line2End) {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(line1Start, line2Start, line2End) !== ccw(line1End, line2Start, line2End) &&
           ccw(line1Start, line1End, line2Start) !== ccw(line1Start, line1End, line2End);
  }

  /**
   * Tests if a line intersects with a rectangle, including buffer zones.
   * Expands the rectangle by collision and visual buffers before testing intersection.
   * 
   * @param {Object} start - Starting point of the line
   * @param {number} start.x - X coordinate of line start
   * @param {number} start.y - Y coordinate of line start
   * @param {Object} end - Ending point of the line
   * @param {number} end.x - X coordinate of line end
   * @param {number} end.y - Y coordinate of line end
   * @param {Object} rect - Rectangle to test against
   * @param {number} rect.x - Left edge of rectangle
   * @param {number} rect.y - Top edge of rectangle
   * @param {number} rect.right - Right edge of rectangle
   * @param {number} rect.bottom - Bottom edge of rectangle
   * @returns {boolean} True if line intersects the buffered rectangle
   * 
   * @example
   * // Test if connection line would collide with table
   * const wouldCollide = math.lineIntersectsRectSimple(
   *   connectionStart, connectionEnd, tableRect
   * );
   */
  lineIntersectsRectSimple(start, end, rect) {
    const collisionBuffer = this.options.collisionBuffer;
    const visualBuffer = this.options.visualBuffer;
    const totalBuffer = collisionBuffer + visualBuffer;
    
    const expandedRect = {
      x: rect.x - totalBuffer,
      y: rect.y - totalBuffer,
      right: rect.right + totalBuffer,
      bottom: rect.bottom + totalBuffer
    };

    return this.lineIntersectsBox(start, end, expandedRect);
  }

  /**
   * Finds the optimal connection points between two table rectangles.
   * Considers all possible side combinations and chooses the shortest path with preferences.
   * 
   * @param {Object} fromRect - Source table rectangle
   * @param {number} fromRect.x - Left edge of source table
   * @param {number} fromRect.y - Top edge of source table
   * @param {number} fromRect.right - Right edge of source table
   * @param {number} fromRect.bottom - Bottom edge of source table
   * @param {number} fromRect.centerX - Horizontal center of source table
   * @param {Object} toRect - Target table rectangle
   * @param {number} toRect.x - Left edge of target table
   * @param {number} toRect.y - Top edge of target table
   * @param {number} toRect.right - Right edge of target table
   * @param {number} toRect.bottom - Bottom edge of target table
   * @param {number} toRect.centerX - Horizontal center of target table
   * @param {number} fromColumnY - Y coordinate of source column
   * @param {number} toColumnY - Y coordinate of target column
   * @returns {Object} Best connection configuration
   * @returns {Object} returns.start - Connection start point (with margin)
   * @returns {Object} returns.end - Connection end point (with margin)
   * @returns {string} returns.fromSide - Side of source table ('left', 'right', 'top', 'bottom')
   * @returns {string} returns.toSide - Side of target table ('left', 'right', 'top', 'bottom')
   * @returns {Object} returns.tableStart - Exact table edge point
   * @returns {Object} returns.tableEnd - Exact table edge point
   * 
   * @example
   * const connection = math.findBestConnectionPoints(
   *   sourceTable, targetTable, sourceColumnY, targetColumnY
   * );
   * console.log(`Connect from ${connection.fromSide} to ${connection.toSide}`);
   */
  findBestConnectionPoints(fromRect, toRect, fromColumnY, toColumnY) {
    const connectionMargin = this.options.connectionMargin;
    
    // Calculate potential connection points on each side
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

    // Find the shortest valid connection
    let bestDistance = Infinity;
    let bestConnection = null;
    
    for (const [fromSide, fromPoint] of Object.entries(fromPoints)) {
      for (const [toSide, toPoint] of Object.entries(toPoints)) {
        const distance = this.distance(fromPoint, toPoint);
        
        // Strongly prefer horizontal connections
        let weight = distance;
        if ((fromSide === 'right' && toSide === 'left') || (fromSide === 'left' && toSide === 'right')) {
          weight *= 0.6; // Strong preference for horizontal
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

  /**
   * Checks if a route defined by waypoints is clear of obstacles.
   * Tests each segment of the route against all obstacle rectangles.
   * 
   * @param {Object[]} waypoints - Array of points defining the route
   * @param {number} waypoints[].x - X coordinate of waypoint
   * @param {number} waypoints[].y - Y coordinate of waypoint
   * @param {Object[]} obstacles - Array of rectangle obstacles to avoid
   * @param {number} obstacles[].x - Left edge of obstacle
   * @param {number} obstacles[].y - Top edge of obstacle
   * @param {number} obstacles[].right - Right edge of obstacle
   * @param {number} obstacles[].bottom - Bottom edge of obstacle
   * @returns {boolean} True if the entire route is clear of obstacles
   * 
   * @example
   * const route = [{x: 0, y: 0}, {x: 50, y: 0}, {x: 50, y: 100}];
   * const tables = [/* array of table rectangles ;
   * const isClear = math.isRouteClear(route, tables);
   */
  isRouteClear(waypoints, obstacles) {
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

  /**
   * Creates simple L-shaped routing options between two points.
   * Generates both horizontal-first and vertical-first routes.
   * 
   * @param {Object} start - Starting point
   * @param {number} start.x - X coordinate of start point
   * @param {number} start.y - Y coordinate of start point
   * @param {Object} end - Ending point
   * @param {number} end.x - X coordinate of end point
   * @param {number} end.y - Y coordinate of end point
   * @returns {Object[][]} Array containing two route options, each as an array of waypoints
   * 
   * @example
   * const routes = math.createSimpleRoutes(
   *   {x: 0, y: 0}, {x: 100, y: 50}
   * );
   * console.log(routes[0]); // Horizontal-first: [{x:0,y:0}, {x:100,y:0}, {x:100,y:50}]
   * console.log(routes[1]); // Vertical-first: [{x:0,y:0}, {x:0,y:50}, {x:100,y:50}]
   */
  createSimpleRoutes(start, end) {
    return [
      // Horizontal first, then vertical
      [start, { x: end.x, y: start.y }, end],
      // Vertical first, then horizontal  
      [start, { x: start.x, y: end.y }, end]
    ];
  }

  /**
   * Creates a route using safe margin areas around the diagram canvas.
   * Routes connections around the perimeter to avoid crossing through dense table clusters.
   * 
   * @param {Object} start - Starting point
   * @param {number} start.x - X coordinate of start point
   * @param {number} start.y - Y coordinate of start point
   * @param {Object} end - Ending point
   * @param {number} end.x - X coordinate of end point
   * @param {number} end.y - Y coordinate of end point
   * @param {Object} bounds - Canvas bounds for routing calculations
   * @param {number} bounds.width - Canvas width
   * @param {number} bounds.height - Canvas height
   * @returns {Object[]} Array of waypoints defining the margin route
   * 
   * @example
   * const bounds = {width: 1000, height: 800};
   * const marginRoute = math.createMarginRoute(startPoint, endPoint, bounds);
   * // Creates route that goes around canvas edges to avoid table clusters
   */
  createMarginRoute(start, end, bounds) {
    const safeZone = this.options.canvasMargin - this.options.safeZoneOffset;
    
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
      // Same quadrant - use top margin as safe route
      return [start, 
        { x: start.x, y: safeZone + this.options.routingSpacingTop }, 
        { x: end.x, y: safeZone + this.options.routingSpacingTop }, 
        end];
    }
  }

  /**
   * Creates a smooth curved SVG path from a series of waypoints.
   * Generates rounded corners at waypoints and adds arrowheads to the final segment.
   * 
   * @param {Object[]} waypoints - Array of points defining the path
   * @param {number} waypoints[].x - X coordinate of waypoint
   * @param {number} waypoints[].y - Y coordinate of waypoint
   * @returns {string} SVG path data string for smooth curved path with arrow
   * 
   * @example
   * const waypoints = [{x: 0, y: 0}, {x: 50, y: 0}, {x: 50, y: 100}];
   * const pathData = math.createSmoothPath(waypoints);
   * // Returns: "M 0,0 L 35,0 Q 50,0 50,15 L 50,100 M 50,100 L ..."
   * 
   * @example
   * // Use in SVG path element
   * const svgPath = `<path d="${pathData}" stroke="blue" fill="none" />`;
   */
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
}

module.exports = { DiagramMath };