class DiagramMath {
  constructor(options) {
    this.options = options;
  }

  // Estimate text width in pixels (approximation for monospace-ish fonts)
  estimateTextWidth(text, fontSize = 12) {
    // Rough approximation: average character width in pixels
    const avgCharWidth = fontSize * 0.6; // Adjust this factor based on font
    return text.length * avgCharWidth;
  }

  // Calculate distance between two points
  distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
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

  // Simple line-rectangle intersection (with configurable buffer)
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

  // Find the best connection points on table edges
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

  // Check if a route is clear of obstacles
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

  // Create simple L-shaped routes
  createSimpleRoutes(start, end) {
    return [
      // Horizontal first, then vertical
      [start, { x: end.x, y: start.y }, end],
      // Vertical first, then horizontal  
      [start, { x: start.x, y: end.y }, end]
    ];
  }

  // Create a route using the safe margin areas
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