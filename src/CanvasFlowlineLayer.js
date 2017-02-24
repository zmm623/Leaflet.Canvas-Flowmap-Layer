define([
  'dojo/_base/declare',
  'dojo/_base/lang',
  'dojo/dom-construct',
  'dojo/on',

  'esri/Color',
  'esri/geometry/Point',
  'esri/graphic',
  'esri/layers/GraphicsLayer',
  'esri/SpatialReference',
  'esri/symbols/SimpleMarkerSymbol'
], function(
  declare, lang, domConstruct, on,
  Color, Point, Graphic, GraphicsLayer, SpatialReference, SimpleMarkerSymbol
) {
  return declare([GraphicsLayer], {
    constructor: function(options) {
      // PUBLIC properties and options

      // REQUIRED to be provided by the developer

      this.originAndDestinationFieldIds = options.originAndDestinationFieldIds;

      // OPTIONAL and not required to be provided by the developer

      // canvas symbol properties are based on Esri REST API simple renderer and unique value renderer specifications
      // http://resources.arcgis.com/en/help/arcgis-rest-api/#/Renderer_objects/02r30000019t000000/
      // "type" can be:
      //    - simple renderer
      //    - unique values renderer
      this.originCircleProperties = options.originCircleProperties || {
        type: 'simple',
        symbol: {
          globalCompositeOperation: 'destination-over',
          radius: 5,
          fillStyle: 'rgba(195, 255, 62, 0.60)',
          lineWidth: 1,
          strokeStyle: 'rgb(195, 255, 62)',
          shadowBlur: 0
        }
      };

      this.originHighlightCircleProperties = options.originHighlightCircleProperties || {
        type: 'simple',
        symbol: {
          globalCompositeOperation: 'destination-over',
          radius: 6,
          fillStyle: 'rgba(195, 255, 62, 0.60)',
          lineWidth: 4,
          strokeStyle: 'rgb(207, 0, 51)',
          shadowBlur: 0
        }
      };

      this.destinationCircleProperties = options.destinationCircleProperties || {
        type: 'simple',
        symbol: {
          globalCompositeOperation: 'destination-over',
          radius: 2.5,
          fillStyle: 'rgba(17, 142, 170, 0.7)',
          lineWidth: 0.25,
          strokeStyle: 'rgb(17, 142, 170)',
          shadowBlur: 0
        }
      };

      this.destinationHighlightCircleProperties = options.destinationHighlightCircleProperties || {
        type: 'simple',
        symbol: {
          globalCompositeOperation: 'destination-over',
          radius: 2,
          fillStyle: 'rgba(17, 142, 170, 0.7)',
          lineWidth: 6,
          strokeStyle: 'rgb(255, 0, 51)',
          shadowBlur: 0
        }
      };

      this.pathProperties = options.pathProperties || {
        type: 'simple',
        symbol: {
          strokeStyle: 'rgba(255, 0, 51, 0.8)',
          lineWidth: 0.75,
          lineCap: 'round',
          shadowColor: 'rgb(255, 0, 51)',
          shadowBlur: 1.5
        }
      };

      this.animatePathProperties = options.animatePathProperties || {
        type: 'simple',
        symbol: {
          strokeStyle: 'rgb(255, 46, 88)',
          lineWidth: 1.25,
          lineDashOffsetSize: 4, // custom property used with animation sprite sizes
          lineCap: 'round',
          shadowColor: 'rgb(255, 0, 51)',
          shadowBlur: 2
        }
      };

      this.pathDisplayMode = options.pathDisplayMode || 'all'; // valid values: 'selection' or 'all'

      this.wrapAroundCanvas = options.hasOwnProperty('wrapAroundCanvas') ? options.wrapAroundCanvas : true; // Boolean

      this.animationStarted = options.hasOwnProperty('animationStarted') ? options.animationStarted : false; // Boolean

      this.animationStyle = options.animationStyle || 'ease-out'; // valid values: 'linear', 'ease-out', or 'ease-in'

      // PRIVATE properties for internal usage

      this._previousPanDelta = {
        x: 0,
        y: 0
      };

      this._listeners = [];

      // animation properties
      this._offset = 0;
      this._resetOffset = 200;
      this._lineDashOffsetSize = this.animatePathProperties.symbol.lineDashOffsetSize;
      this._defaultEaseOutIncrementer = 0.2;
      this._defaultEaseInIncrementer = 0.1;
      if (this.animationStyle === 'ease-out') {
        this._incrementer = this._defaultEaseOutIncrementer;
      } else if (this.animationStyle === 'ease-in') {
        this._incrementer = this._defaultEaseInIncrementer;
      } else {
        // TODO: let developers define their own default this._incrementer value
      }
    },

    /*
    EXTENDED JSAPI GRAPHICSLAYER METHODS
    */

    // TODO: test out and finalize which GraphicsLayer methods need to be overridden

    _setMap: function() {
      var div = this.inherited(arguments); // required for JSAPI

      var canvasElements = this._getCustomCanvasElements();
      this._canvasElement = canvasElements.canvasElementBottom;
      this._animationCanvasElement = canvasElements.canvasElementTop;

      if (this._listeners.length) {
        this._toggleListeners();
        if (this.visible) {
          this._redrawCanvas();
        }
      } else {
        this._initListeners();
      }

      return div; // required for JSAPI
    },

    _unsetMap: function() {
      this.inherited(arguments);
      var forceOff = true;
      this._toggleListeners(forceOff);
      this._clearCanvas();
    },

    // add: function(graphic) {
    //   this.inherited(arguments);
    // },

    // clear: function() {
    //   this.inherited(arguments);
    //   this._clearCanvas();
    // },

    /*
    PUBLIC METHODS
    */

    clearAllPathSelections: function() {
      this.graphics.forEach(function(graphic) {
        graphic.attributes._isSelectedForPathDisplay = false;
      });

      this._redrawCanvas();
    },

    clearAllHighlightSelections: function() {
      this.graphics.forEach(function(graphic) {
        graphic.attributes._isSelectedForHighlight = false;
      });

      this._redrawCanvas();
    },

    selectGraphicsForPathDisplay: function(selectionGraphics, selectionMode) {
      this._applyGraphicsSelection(selectionGraphics, selectionMode, '_isSelectedForPathDisplay');
    },

    selectGraphicsForPathDisplayById: function(uniqueOriginOrDestinationIdField, idValue, originBoolean, selectionMode) {
      if (
        uniqueOriginOrDestinationIdField !== this.originAndDestinationFieldIds.originUniqueIdField &&
        uniqueOriginOrDestinationIdField !== this.originAndDestinationFieldIds.destinationUniqueIdField
      ) {
        console.error('Invalid unique id field supplied for origin or destination. It must be one of these: ' +
          this.originAndDestinationFieldIds.originUniqueIdField + ', ' + this.originAndDestinationFieldIds.destinationUniqueIdField);
        return;
      }

      var existingOriginOrDestinationGraphic = this.graphics.filter(function(graphic) {
        return graphic.attributes._isOrigin === originBoolean &&
          graphic.attributes[uniqueOriginOrDestinationIdField] === idValue;
      })[0];

      var odInfo = this._getSharedOriginOrDestinationGraphics(existingOriginOrDestinationGraphic);

      if (odInfo.isOriginGraphic) {
        this.selectGraphicsForPathDisplay(odInfo.sharedOriginGraphics, selectionMode);
      } else {
        this.selectGraphicsForPathDisplay(odInfo.sharedDestinationGraphics, selectionMode);
      }
    },

    selectGraphicsForHighlight: function(selectionGraphics, selectionMode) {
      this._applyGraphicsSelection(selectionGraphics, selectionMode, '_isSelectedForHighlight');
    },

    addGraphics: function(inputGraphics) {
      inputGraphics.forEach(function(inputGraphic, index) {
        if (inputGraphic.declaredClass === 'esri.Graphic') {
          var inputGraphicJson = inputGraphic.toJson();

          // origin point
          var originGhostGraphic = this._constructGhostGraphic(inputGraphicJson, true, index + '_o');
          this.add(originGhostGraphic);

          // destination point
          var destinationGhostGraphic = this._constructGhostGraphic(inputGraphicJson, false, index + '_d');
          this.add(destinationGhostGraphic);
        }
      }, this);

      this._redrawCanvas();
    },

    playAnimation: function(animationStyle) {
      this.animationStyle = animationStyle || this.animationStyle;
      this.animationStarted = true;
      this._redrawCanvas();
    },

    stopAnimation: function() {
      this.animationStarted = false;
      this._redrawCanvas();
    },

    /*
    PRIVATE METHODS
    */

    _initListeners: function() {
      // custom handling of when setVisibility(), show(), or hide() are called on the layer
      this.on('visibility-change', lang.hitch(this, function(evt) {
        this._toggleListeners();
        if (evt.visible) {
          this._redrawCanvas();
        } else {
          this._clearCanvas();
        }
      }));

      // pausable listeners

      // when user finishes zooming or panning the map
      this._listeners.push(on.pausable(this._map, 'extent-change', lang.hitch(this, '_redrawCanvas')));

      // when user begins zooming the map
      this._listeners.push(on.pausable(this._map, 'zoom-start', lang.hitch(this, '_clearCanvas')));

      // when user is actively panning the map
      this._listeners.push(on.pausable(this._map, 'pan', lang.hitch(this, '_panCanvas')));

      // when map is resized in the browser
      this._listeners.push(on.pausable(this._map, 'resize', lang.hitch(this, '_resizeCanvas')));

      // when user interacts with a graphic by click or mouse-over,
      // provide additional event properties
      this._listeners.push(on.pausable(this, 'click,mouse-over', lang.hitch(this, function(evt) {
        var odInfo = this._getSharedOriginOrDestinationGraphics(evt.graphic);
        evt.isOriginGraphic = odInfo.isOriginGraphic;
        evt.sharedOriginGraphics = odInfo.sharedOriginGraphics;
        evt.sharedDestinationGraphics = odInfo.sharedDestinationGraphics;
      })));

      // pause or resume the pausable listeners depending on initial layer visibility
      this._toggleListeners();
    },

    _toggleListeners: function(forceOff) {
      forceOff = forceOff || !this.visible;
      var pausableMethodName = forceOff ? 'pause' : 'resume';
      this._listeners.forEach(function(listener) {
        listener[pausableMethodName]();
      });
    },

    _getCustomCanvasElements: function() {
      var canvasStageElementId = this.id;

      // look up if it is already in the DOM
      var canvasStageElement = document.querySelector('#' + canvasStageElementId);

      var canvasElementTop, canvasElementBottom;
      // if not in the DOM, create it only once
      if (!canvasStageElement) {
        var _mapImageLayerDivs = document.querySelectorAll('div[id^=\'map_layer\']');
        var _lastMapImageLayerDiv = _mapImageLayerDivs[_mapImageLayerDivs.length - 1];

        canvasElementTop = domConstruct.create('canvas', {
          id: canvasStageElementId + '_topCanvas',
          width: this._map.width + 'px',
          height: this._map.height + 'px',
          style: 'position: absolute; left: 0px; top: 0px;'
        }, _lastMapImageLayerDiv, 'after');

        canvasElementBottom = domConstruct.create('canvas', {
          id: canvasStageElementId + '_bottomCanvas',
          width: this._map.width + 'px',
          height: this._map.height + 'px',
          style: 'position: absolute; left: 0px; top: 0px;'
        }, canvasElementTop, 'before');
      } else {
        canvasElementTop = document.querySelector('#' + canvasStageElementId + '_topCanvas');
        canvasElementBottom = document.querySelector('#' + canvasStageElementId + '_bottomCanvas');
      }

      return {
        canvasElementTop: canvasElementTop,
        canvasElementBottom: canvasElementBottom
      };
    },

    _clearCanvas: function() {
      // clear out previous drawn canvas content
      // e.g. when a zoom begins,
      // or just prior to changing the displayed contents in the canvas
      var ctx = this._canvasElement.getContext('2d');
      ctx.clearRect(0, 0, this._canvasElement.width, this._canvasElement.height);

      ctx = this._animationCanvasElement.getContext('2d');
      ctx.clearRect(0, 0, this._animationCanvasElement.width, this._animationCanvasElement.height);
      if (this._animationFrameId) {
        window.cancelAnimationFrame(this._animationFrameId);
      }

      // reset canvas element position and pan delta info
      // for the next panning events
      this._canvasElement.style.left = '0px';
      this._canvasElement.style.top = '0px';

      this._animationCanvasElement.style.left = '0px';
      this._animationCanvasElement.style.top = '0px';

      this._previousPanDelta = {
        x: 0,
        y: 0
      };
    },

    _redrawCanvas: function() {
      if (this.visible) {
        this._clearCanvas();
        // canvas re-drawing of all the origin/destination points
        this._drawAllCanvasPoints();
        // loop over each of the "selected" graphics and re-draw the canvas paths
        this._drawSelectedCanvasPaths(false);
        // clear/reset previous animation frames
        if (this._animationFrameId) {
          window.cancelAnimationFrame(this._animationFrameId);
        }
        if (this.animationStarted) {
          // start animation loop
          this._animator();
        }
      }
    },

    _panCanvas: function(evt) {
      // move the canvas while the map is being panned

      var canvasLeft = Number(this._canvasElement.style.left.split('px')[0]);
      var canvasTop = Number(this._canvasElement.style.top.split('px')[0]);

      var modifyLeft = evt.delta.x - this._previousPanDelta.x;
      var modifyTop = evt.delta.y - this._previousPanDelta.y;

      // set canvas element position
      this._canvasElement.style.left = canvasLeft + modifyLeft + 'px';
      this._canvasElement.style.top = canvasTop + modifyTop + 'px';

      this._animationCanvasElement.style.left = canvasLeft + modifyLeft + 'px';
      this._animationCanvasElement.style.top = canvasTop + modifyTop + 'px';

      // set pan delta info for the next panning events
      this._previousPanDelta = evt.delta;
    },

    _resizeCanvas: function() {
      // resize the canvas if the map was resized
      this._canvasElement.width = this._map.width;
      this._canvasElement.height = this._map.height;

      this._animationCanvasElement.width = this._map.width;
      this._animationCanvasElement.height = this._map.height;
    },

    _getSharedOriginOrDestinationGraphics: function(testGraphic) {
      var isOriginGraphic = testGraphic.attributes._isOrigin;
      var sharedOriginGraphics = [];
      var sharedDestinationGraphics = [];

      if (isOriginGraphic) {
        // for an ORIGIN point that was interacted with,
        // make an array of all other ORIGIN graphics with the same ORIGIN ID field
        var originUniqueIdField = this.originAndDestinationFieldIds.originUniqueIdField;
        var testGraphicOriginId = testGraphic.attributes[originUniqueIdField];
        sharedOriginGraphics = this.graphics.filter(function(graphic) {
          return graphic.attributes._isOrigin &&
            graphic.attributes[originUniqueIdField] === testGraphicOriginId;
        });
      } else {
        // for a DESTINATION point that was interacted with,
        // make an array of all other ORIGIN graphics with the same DESTINATION ID field
        var destinationUniqueIdField = this.originAndDestinationFieldIds.destinationUniqueIdField;
        var testGraphicDestinationId = testGraphic.attributes[destinationUniqueIdField];
        sharedDestinationGraphics = this.graphics.filter(function(graphic) {
          return graphic.attributes._isOrigin &&
            graphic.attributes[destinationUniqueIdField] === testGraphicDestinationId;
        });
      }

      return {
        isOriginGraphic: isOriginGraphic, // Boolean
        sharedOriginGraphics: sharedOriginGraphics, // Array of graphics
        sharedDestinationGraphics: sharedDestinationGraphics // Array of graphics
      };
    },

    _applyGraphicsSelection: function(selectionGraphics, selectionMode, selectionAttributeName) {
      var selectionIds = selectionGraphics.map(function(graphic) {
        return graphic.attributes._uniqueId;
      });

      if (selectionMode === 'SELECTION_NEW') {
        this.graphics.forEach(function(graphic) {
          if (selectionIds.indexOf(graphic.attributes._uniqueId) > -1) {
            graphic.attributes[selectionAttributeName] = true;
          } else {
            graphic.attributes[selectionAttributeName] = false;
          }
        });
      } else if (selectionMode === 'SELECTION_ADD') {
        this.graphics.forEach(function(graphic) {
          if (selectionIds.indexOf(graphic.attributes._uniqueId) > -1) {
            graphic.attributes[selectionAttributeName] = true;
          }
        });
      } else if (selectionMode === 'SELECTION_SUBTRACT') {
        this.graphics.forEach(function(graphic) {
          if (selectionIds.indexOf(graphic.attributes._uniqueId) > -1) {
            graphic.attributes[selectionAttributeName] = false;
          }
        });
      } else {
        return;
      }

      this._redrawCanvas();
    },

    _constructGhostGraphic: function(inputGraphicJson, isOrigin, uniqueId) {
      var configGeometryObject;
      var configCirclePropertyObject;

      if (isOrigin) {
        configGeometryObject = this.originAndDestinationFieldIds.originGeometry;
        configCirclePropertyObject = this.originCircleProperties;
      } else {
        configGeometryObject = this.originAndDestinationFieldIds.destinationGeometry;
        configCirclePropertyObject = this.destinationCircleProperties;
      }

      var clonedGraphicJson = lang.clone(inputGraphicJson);
      clonedGraphicJson.geometry.x = clonedGraphicJson.attributes[configGeometryObject.x];
      clonedGraphicJson.geometry.y = clonedGraphicJson.attributes[configGeometryObject.y];
      clonedGraphicJson.geometry.spatialReference = new SpatialReference(configGeometryObject.spatialReference.wkid);

      var ghostGraphic = new Graphic(clonedGraphicJson);
      ghostGraphic.setAttributes(lang.mixin(ghostGraphic.attributes, {
        _isOrigin: isOrigin,
        _isSelectedForPathDisplay: this.pathDisplayMode === 'all' && isOrigin ? true : false,
        _isSelectedForHighlight: false,
        _uniqueId: uniqueId
      }));

      var ghostSymbol = new SimpleMarkerSymbol();
      ghostSymbol.setColor(new Color([0, 0, 0, 0]));

      // make the ghost graphic symbol size directly tied to the size of the canvas circle
      // instead of, for example: ghostSymbol.setSize(8);
      var ghostSymbolRadius;
      if (configCirclePropertyObject.type === 'simple') {
        ghostSymbolRadius = configCirclePropertyObject.symbol.radius;
      } else if (configCirclePropertyObject.type === 'uniqueValue') {
        ghostSymbolRadius = configCirclePropertyObject.uniqueValueInfos.filter(function(info) {
          return info.value === ghostGraphic.attributes[configCirclePropertyObject.field];
        })[0].symbol.radius;
      } else if (configCirclePropertyObject.type === 'classBreaks') {
        var filteredSymbols = configCirclePropertyObject.classBreakInfos.filter(function(info) {
          return (
            info.classMinValue <= ghostGraphic.attributes[configCirclePropertyObject.field] &&
            info.classMaxValue >= ghostGraphic.attributes[configCirclePropertyObject.field]
          );
        });
        if (filteredSymbols.length) {
          ghostSymbolRadius = filteredSymbols[0].symbol.radius;
        } else {
          ghostSymbolRadius = configCirclePropertyObject.defaultSymbol.radius;
        }
      }

      ghostSymbol.setSize(ghostSymbolRadius * 2);

      ghostSymbol.outline.setColor(new Color([0, 0, 0, 0]));
      ghostSymbol.outline.setWidth(0);

      ghostGraphic.setSymbol(ghostSymbol);

      return ghostGraphic;
    },

    _drawAllCanvasPoints: function() {

      // re-draw only 1 copy of each unique ORIGIN or DESTINATION point using the canvas
      // and add the unique value value to the appropriate array for tracking and comparison
      // NOTE: all of the "ghost" graphics will still be available for the click and mouse-over listeners

      // reset temporary tracking arrays to make sure only 1 copy of each origin or destination point gets drawn on the canvas
      var originUniqueIdValues = [];
      var destinationUniqueIdValues = [];

      var originUniqueIdField = this.originAndDestinationFieldIds.originUniqueIdField;
      var destinationUniqueIdField = this.originAndDestinationFieldIds.destinationUniqueIdField;

      var ctx = this._canvasElement.getContext('2d');

      // loop over all graphics
      this.graphics.forEach(function(graphic) {
        var attributes = graphic.attributes;
        var isOrigin = attributes._isOrigin;
        var canvasCircleProperties;

        if (isOrigin && originUniqueIdValues.indexOf(attributes[originUniqueIdField]) === -1) {
          originUniqueIdValues.push(attributes[originUniqueIdField]);
          canvasCircleProperties = attributes._isSelectedForHighlight ? this.originHighlightCircleProperties : this.originCircleProperties;

          this._drawNewCanvasPoint(ctx, graphic, canvasCircleProperties);
        } else if (!isOrigin && destinationUniqueIdValues.indexOf(attributes[destinationUniqueIdField]) === -1) {
          destinationUniqueIdValues.push(attributes[destinationUniqueIdField]);
          canvasCircleProperties = attributes._isSelectedForHighlight ? this.destinationHighlightCircleProperties : this.destinationCircleProperties;

          this._drawNewCanvasPoint(ctx, graphic, canvasCircleProperties);
        }

      }, this);
    },

    _drawNewCanvasPoint: function(ctx, graphic, canvasCircleProperties) {
      // get the canvas symbol properties
      var symbol;
      if (canvasCircleProperties.type === 'simple') {
        symbol = canvasCircleProperties.symbol;
      } else if (canvasCircleProperties.type === 'uniqueValue') {
        symbol = canvasCircleProperties.uniqueValueInfos.filter(function(info) {
          return info.value === graphic.attributes[canvasCircleProperties.field];
        })[0].symbol;
      } else if (canvasCircleProperties.type === 'classBreaks') {
        var filteredSymbols = canvasCircleProperties.classBreakInfos.filter(function(info) {
          return (
            info.classMinValue <= graphic.attributes[canvasCircleProperties.field] &&
            info.classMaxValue >= graphic.attributes[canvasCircleProperties.field]
          );
        });
        if (filteredSymbols.length) {
          symbol = filteredSymbols[0].symbol;
        } else {
          symbol = canvasCircleProperties.defaultSymbol;
        }
      }

      // ensure that canvas features will be drawn beyond +/-180 longitude
      var geometry = this._wrapAroundCanvasPointGeometry(graphic.geometry);

      // convert geometry to screen coordinates for canvas drawing
      var screenPoint = this._map.toScreen(geometry);

      // draw a circle point on the canvas
      this._applyCanvasPointSymbol(ctx, symbol, screenPoint);
    },

    _applyCanvasPointSymbol: function(ctx, symbolObject, screenPoint) {
      ctx.globalCompositeOperation = symbolObject.globalCompositeOperation;
      ctx.fillStyle = symbolObject.fillStyle;
      ctx.lineWidth = symbolObject.lineWidth;
      ctx.strokeStyle = symbolObject.strokeStyle;
      ctx.shadowBlur = symbolObject.shadowBlur;
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, symbolObject.radius, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.stroke();
      ctx.closePath();
    },

    _drawSelectedCanvasPaths: function(animate) {
      var originAndDestinationFieldIds = this.originAndDestinationFieldIds;

      var ctx;
      if (animate) {
        ctx = this._animationCanvasElement.getContext('2d');
      } else {
        ctx = this._canvasElement.getContext('2d');
      }
      ctx.beginPath();

      this.graphics.forEach(function(graphic) {
        var attributes = graphic.attributes;

        if (attributes._isSelectedForPathDisplay) {
          var originXCoordinate = attributes[originAndDestinationFieldIds.originGeometry.x];
          var originYCoordinate = attributes[originAndDestinationFieldIds.originGeometry.y];
          var destinationXCoordinate = attributes[originAndDestinationFieldIds.destinationGeometry.x];
          var destinationYCoordinate = attributes[originAndDestinationFieldIds.destinationGeometry.y];
          var spatialReference = graphic.geometry.spatialReference;

          if (animate) {
            this._drawNewCanvasPath(
              ctx,
              this.animatePathProperties,
              attributes,
              originXCoordinate, originYCoordinate,
              destinationXCoordinate, destinationYCoordinate,
              spatialReference,
              animate
            );
          } else {
            this._drawNewCanvasPath(
              ctx,
              this.pathProperties,
              attributes,
              originXCoordinate, originYCoordinate,
              destinationXCoordinate, destinationYCoordinate,
              spatialReference
            );
          }

        }
      }, this);

      ctx.stroke();
      ctx.closePath();
    },

    _drawNewCanvasPath: function(ctx, canvasPathProperties, graphicAttributes, originXCoordinate, originYCoordinate, destinationXCoordinate, destinationYCoordinate, spatialReference, animate) {
      // get the canvas symbol properties
      var symbol;
      var filteredSymbols;
      if (canvasPathProperties.type === 'simple') {
        symbol = canvasPathProperties.symbol;
      } else if (canvasPathProperties.type === 'uniqueValue') {
        filteredSymbols = canvasPathProperties.uniqueValueInfos.filter(function(info) {
          return info.value === graphicAttributes[canvasPathProperties.field];
        });
        symbol = filteredSymbols[0].symbol;
      } else if (canvasPathProperties.type === 'classBreaks') {
        filteredSymbols = canvasPathProperties.classBreakInfos.filter(function(info) {
          return (
            info.classMinValue <= graphicAttributes[canvasPathProperties.field] &&
            info.classMaxValue >= graphicAttributes[canvasPathProperties.field]
          );
        });
        if (filteredSymbols.length) {
          symbol = filteredSymbols[0].symbol;
        } else {
          symbol = canvasPathProperties.defaultSymbol;
        }
      }

      // origin and destination points for drawing curved lines
      // ensure that canvas features will be drawn beyond +/-180 longitude
      var originPoint = this._wrapAroundCanvasPointGeometry(new Point(originXCoordinate, originYCoordinate, spatialReference));
      var destinationPoint = this._wrapAroundCanvasPointGeometry(new Point(destinationXCoordinate, destinationYCoordinate, spatialReference));

      // convert geometry to screen coordinates for canvas drawing
      var screenOriginPoint = this._map.toScreen(originPoint);
      var screenDestinationPoint = this._map.toScreen(destinationPoint);

      // draw a curved canvas line
      if (animate) {
        this._animateCanvasLineSymbol(ctx, symbol, screenOriginPoint, screenDestinationPoint);
      } else {
        this._applyCanvasLineSymbol(ctx, symbol, screenOriginPoint, screenDestinationPoint);
      }
    },

    _applyCanvasLineSymbol: function(ctx, symbolObject, screenOriginPoint, screenDestinationPoint) {
      ctx.lineCap = symbolObject.lineCap;
      ctx.lineWidth = symbolObject.lineWidth;
      ctx.strokeStyle = symbolObject.strokeStyle;
      ctx.shadowBlur = symbolObject.shadowBlur;
      ctx.shadowColor = symbolObject.shadowColor;
      ctx.moveTo(screenOriginPoint.x, screenOriginPoint.y);
      ctx.bezierCurveTo(screenOriginPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y);
    },

    _animateCanvasLineSymbol: function(ctx, symbolObject, screenOriginPoint, screenDestinationPoint) {
      ctx.lineCap = symbolObject.lineCap;
      ctx.lineWidth = symbolObject.lineWidth;
      ctx.strokeStyle = symbolObject.strokeStyle;
      ctx.shadowBlur = symbolObject.shadowBlur;
      ctx.shadowColor = symbolObject.shadowColor;
      ctx.setLineDash([this._lineDashOffsetSize, this._lineDashOffsetSize + this._resetOffset]);
      ctx.lineDashOffset = -this._offset; // this makes the dot appear to move when the entire top canvas is redrawn
      ctx.moveTo(screenOriginPoint.x, screenOriginPoint.y);
      ctx.bezierCurveTo(screenOriginPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y);
    },

    _animator: function() {
      this._applyAnimator();

      var ctx = this._animationCanvasElement.getContext('2d');
      ctx.clearRect(0, 0, this._animationCanvasElement.width, this._animationCanvasElement.height);
      this._drawSelectedCanvasPaths(true); // draw it again to give the appearance of a moving dot with a new lineDashOffset
      this._animationFrameId = window.requestAnimationFrame(lang.hitch(this, '_animator'));
    },

    _applyAnimator: function() {
      if (this.animationStyle === 'linear') {
        this._linearAnimator();
      } else if (this.animationStyle === 'ease-out') {
        this._easeOutAnimator();
      } else if (this.animationStyle === 'ease-in') {
        this._easeInAnimator();
      } else {
        // TODO: let developers define their own animator function
        // this._customAnimator();
      }
    },

    _linearAnimator: function() {
      // linear: constant rate animation

      this._offset += 1;
    },

    _easeOutAnimator: function() {
      // ease out with linear ending: start fast, slow down, and then remain constant

      this._incrementer = this._incrementer < 1 ? this._incrementer + 0.009 : 1;
      this._offset += (0.9 / this._incrementer);

      if (this._offset > this._resetOffset) {
        this._offset = 0;
        this._incrementer = this._defaultEaseOutIncrementer;
      }
    },

    _easeInAnimator: function() {
      // ease in with linear ending: start slow, speed up, and then remain constant

      this._incrementer = this._incrementer < 55 ? this._incrementer + 1 : this._incrementer;
      this._offset += Math.pow(1.05, this._incrementer);

      if (this._offset > this._resetOffset) {
        this._offset = 0;
        this._incrementer = this._defaultEaseInIncrementer;
      }
    },

    _wrapAroundCanvasPointGeometry: function(geometry) {
      if (this.wrapAroundCanvas) {
        var geometryJsonClone = lang.clone(geometry.toJson());
        var wrappedGeometry = new Point(geometryJsonClone);
        var geometryLongitude = wrappedGeometry.getLongitude();

        var mapCenterLongitude = this._map.geographicExtent.getCenter().getLongitude();

        var wrapAroundDiff = mapCenterLongitude - geometryLongitude;
        if (wrapAroundDiff < -180 || wrapAroundDiff > 180) {
          wrappedGeometry.setLongitude(geometryLongitude + (Math.round(wrapAroundDiff / 360) * 360));
        }
        return wrappedGeometry;
      } else {
        return geometry;
      }
    }

  });
});