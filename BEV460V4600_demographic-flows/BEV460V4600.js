(function (d3, sszvis, BEV460V4600Params) {
  'use strict';

  /* Configuration
  ----------------------------------------------- */
  var config = {
    dataPath: BEV460V4600Params.data,
    title: BEV460V4600Params.title,
    description: BEV460V4600Params.description,
    dateColumn: 'Jahr',
    categoryColumn: 'Definition',
    valueColumn: 'Anzahl',
    rulerLabel: '',
    xLabel: '',
    yLabel: 'Personen',
    ticks: 5,
    targetElement: BEV460V4600Params.id,
    chartPhysicsId: BEV460V4600Params.id + '-physics', // container for physics
    bubbleOverlayId: BEV460V4600Params.id + '-bubbles', // overlay on canvas to display tooltips
    chartBevId: BEV460V4600Params.id + '-stacked-bev', // continer for stacked bar chart with Bevölkerung, Zuzüge, Geburten
    chartOutId: BEV460V4600Params.id + '-stacked-out', // container for stacked bar chart with Wegzüge, Todesfälle
    controlDivId: BEV460V4600Params.id + '-controls', // container for controls, mainly stepper
    framerate: 30, // framerate for physics simulation
    legendCategories: ['Geburten', 'Zuzüge', 'Basisbevölkerung', 'Todesfälle', 'Wegzüge'].reverse(),
    legendColors: ['#77A24E', '#E6CF73', '#5182B3', /* '#CC6788' */ '#AD4B6D' /* '#7A354D' */, '#E67D73'].reverse(),
    colors: [], // to be calculated from legendColors
    handleInteraction: false,
    displayFps: false,
    startYear: 2012,
    maxChartWidth: 800
  };

  if (sszvis.fallback.unsupported()) {
    sszvis.fallback.render(config.targetElement);
    return;
  }

  /* Shortcuts
  ----------------------------------------------- */
  var xAcc = sszvis.fn.prop('date');
  var yAcc = sszvis.fn.prop('value');
  var cAcc = sszvis.fn.prop('category');

  // hold a variable to the drawing Canvas for convenience
  var drawingCanvas = null;

  var lastFrameTime = Date.now();

  config.colors = colorLookup(config.legendCategories, config.legendColors);

  /* Application state
  ----------------------------------------------- */

  // state variables for stacked bar chart with Bevölkerung, Geburten, Zuzüge
  var bevState = {
    data: [],
    stackedData: [],
    maxValue: 0,
    maxStacked: 0,
    categories: [],
    selection: [],
    highlightDate: new Date(),
    highlightData: [],
    totalHighlightValue: 0
  };

  // state variables for stacked bar chart with Wegzüge, Todesfälle
  var outState = {
    data: [],
    stackedData: [],
    maxValue: 0,
    maxStacked: 0,
    categories: [],
    selection: [],
    highlightDate: new Date(),
    highlightData: [],
    totalHighlightValue: 0
  };

  // bubble chart overlay for tooltips on physics canvas
  var bubState = {
    anchors: [],
    voronoiFiltered: [],
    highlightData: []
  };

  var state = {
    data: [],
    posData: [],
    years: [0, 0],
    lineData: [],
    currentDate: null,
    bevChart: bevState,
    outChart: outState,
    bubChart: bubState,
    refreshIntervalId: 0,
    grayParticles: false,
    canvasNeedsUpdate: false
  };

  /* State transitions
  ----------------------------------------------- */
  var actions = {
    prepareState: function (data) {
      state.data = data;

      // sort the data according ascending years to handle data files with unordered data
      state.data.sort(function (a, b) {
        return xAcc(a).getFullYear() - xAcc(b).getFullYear();
      });

      // augment data with lines for bevölkerung2 = bevölkerung - zuzug - geburten
      var zuzug = state.data.filter(function (d) {
        return cAcc(d) === 'Zuzüge';
      });

      var geburt = state.data.filter(function (d) {
        return cAcc(d) === 'Geburten';
      });

      var bevolkerung = state.data.filter(function (d) {
        return cAcc(d) === 'Bevölkerung';
      });

      var zuzugByYear = [];
      zuzug.forEach(function (d) {
        zuzugByYear[d.year] = d;
      });

      var geburtByYear = [];
      geburt.forEach(function (d) {
        geburtByYear[d.year] = d;
      });

      var bevoelkerung2 = bevolkerung.map(function (d) {
        var yr = d.year;
        var newval = d.value - geburtByYear[yr].value - zuzugByYear[yr].value;
        return {
          year: d.year,
          date: d.date,
          category: 'Basisbevölkerung',
          value: newval
        };
      });

      state.data = state.data.concat(bevoelkerung2);

      // list of years
      state.years = d3.extent(state.data, xAcc);

      // get the categories
      state.categories = sszvis.fn.set(state.data, cAcc);

      // create state for stacked bar chart (Bevölkerung, Zuzüge, Geburten)
      state.bevChart = actions.prepareBevState(state.data);

      // create state for stacked bar chart (Todesfälle, Wegzüge)
      state.outChart = actions.prepareOutState(state.data);

      // initialize the physics based on data
      actions.initPhysics(state.data);

      // create state for bubble chart overlay for canvas tooltips, relies on the physics already initialized
      state.bubChart = actions.prepareBubbleState(state.data);

      //  actions.resetDate();
      actions.changeDateStepper(new Date(config.startYear + ''));

      // prerun physics to land in a more quiet world
      for (var i = 0; i < 50; i++) {
        updatePhysics();
      }

      state.refreshIntervalId = setInterval(updatePhysics, 1000 / config.framerate);

      // animate the first few years
      state.entryAnimationId = setInterval(actions.entryAnimation, 1000);
    },
    entryAnimation: function () {
      var endYear = state.years[1].getFullYear();
      var year = state.currentDate.getFullYear();
      var nextYear = year + 1;

      if (nextYear > endYear) {
        clearInterval(state.entryAnimationId);
      } else {
        actions.changeDateStepper(new Date(nextYear + ''));
      }
    },
    prepareOutState: function (_data) {
      var _state = actions.createStackedState(_data, ['Wegzüge', 'Todesfälle']);
      return _state;
    },
    prepareBevState: function (_data) {
      var _state = actions.createStackedState(_data, ['Basisbevölkerung', 'Zuzüge', 'Geburten']);
      return _state;
    },
    prepareBubbleState: function (_data) {
      var _state = {};

      // for the voronoi component to work, the data must first be filtered such that no two vertices
      // fall at exactly the same point.
      _state.anchors = state.physics.getAllAnchors();
      _state.voronoiFiltered = sszvis.fn.derivedSet(_state.anchors, function (d) {
        return d.x + '__' + d.y;
      });

      _state.highlightData = [];

      return _state;
    },

    createStackedState: function (_data, _categories) {
      var _state = {};

      _state.data = _data.filter(function (d) {
        return _categories.indexOf(cAcc(d)) >= 0;
      });

      _state.data.sort(function (a, b) {
        var yearComp = xAcc(a).getFullYear() - xAcc(b).getFullYear();
        var catComp = _categories.indexOf(cAcc(b)) - _categories.indexOf(cAcc(a));
        return yearComp === 0 ? catComp : yearComp;
      });

      _state.stackedData = sszvis.cascade()
        .arrayBy(cAcc)
        .apply(_state.data)
        .map(function (stack) {
          return {
            category: cAcc(stack[0]),
            values: stack
          };
        });

      var dateValues = sszvis.cascade()
        .objectBy(sszvis.fn.compose(String, xAcc))
        .apply(_state.data);

      _state.maxValue = d3.max(_state.data, yAcc);

      _state.maxStacked = d3.max(d3.values(dateValues), function (s) {
        return d3.sum(s, yAcc);
      });

      _state.categories = sszvis.fn.set(_state.data, cAcc);

      return _state;
    },
    changeDateHover: function (inputDate) {
      var date = closestDatum(state.data, sszvis.fn.prop('date'), inputDate).date;
      if (state.bevChart.highlightDate === date) return;

      state.bevChart.highlightDate = date;

      // update selection
      state.selection = state.data.filter(function (d) {
        return d.date === state.bevChart.highlightDate && !isNaN(yAcc(d));
      });

      // update highlight data for stacked bar chart (Bevölkerung, Zuzüge, Geburten)
      state.bevChart.highlightData = state.bevChart.stackedData.map(function (stack) {
        return stack.values.filter(function (v) {
          return xAcc(v).toString() === date.toString();
        })[0];
      });

      // calculate total highlight value for stacked bar chart (Bevölkerung, Zuzüge, Geburten). -> Total 12345
      state.bevChart.totalHighlightValue = state.bevChart.highlightData.reduce(function (m, v) {
        return yAcc(v) + m;
      }, 0);

      // calculate highlight data for stacked bar chart (Todesfälle, Wegzüge)
      state.outChart.highlightData = state.outChart.stackedData.map(function (stack) {
        return stack.values.filter(function (v) {
          return xAcc(v).toString() === date.toString();
        })[0];
      });

      // calculate total highlight value for stacked bar chart (Todesfälle, Wegzüge). -> Total 12345
      state.outChart.totalHighlightValue = state.outChart.highlightData.reduce(function (m, v) {
        return yAcc(v) + m;
      }, 0);

      render(state);
    },

    resetDateHover: function () {
      // set date of stacked area chart to current date
      actions.changeDateHover(state.currentDate);
    },
    changeDateStepper: function (inputDate) {
      var date = closestDatum(state.data, sszvis.fn.prop('date'), inputDate).date;
      //  console.log('changeDateStepper: ', 'inputDate', inputDate, 'calculated date', date);

      // do nothing if we are at the same date
      if (state.currentDate === date) return;

      state.currentDate = date;
      state.bevChart.highlightDate = date;

      // TODO synchronize this coming part with the one in changeDateHover

      // update selection
      state.selection = state.data.filter(function (d) {
        return d.date === state.currentDate && !isNaN(yAcc(d));
      });

      // update highlight data for stacked bar chart (Bevölkerung, Zuzüge, Geburten)
      state.bevChart.highlightData = state.bevChart.stackedData.map(function (stack) {
        return stack.values.filter(function (v) {
          return xAcc(v).toString() === date.toString();
        })[0];
      });

      // calculate total highlight value for stacked bar chart (Bevölkerung, Zuzüge, Geburten). -> Total 12345
      state.bevChart.totalHighlightValue = state.bevChart.highlightData.reduce(function (m, v) {
        return yAcc(v) + m;
      }, 0);

      //   console.log('changeDate: state.bevChart.totalHighlightValue', state.bevChart.totalHighlightValue);

      // calculate highlight data for stacked bar chart (Todesfälle, Wegzüge)
      state.outChart.highlightData = state.outChart.stackedData.map(function (stack) {
        return stack.values.filter(function (v) {
          return xAcc(v).toString() === date.toString();
        })[0];
      });

      //   console.log('changeDate: state.outChart.highlightData', state.outChart.highlightData);

      // calculate total highlight value for stacked bar chart (Todesfälle, Wegzüge). -> Total 12345
      state.outChart.totalHighlightValue = state.outChart.highlightData.reduce(function (m, v) {
        return yAcc(v) + m;
      }, 0);

      //    console.log('changeDate: state.outChart.totalHighlightValue', state.outChart.totalHighlightValue);

      // transform current Date to year
      //   console.log('changeDate: state.currentDate', state.currentDate);
      var yr = state.currentDate.getFullYear();

      // update physics to current year
      //  state.physics.setYear(yr);
      state.physics.setYear2(yr);
      render(state);
    },
    resetDate: function () {
      var mostRecentDate = d3.max(state.data, sszvis.fn.prop('date'));
      actions.changeDate(mostRecentDate);
    },

    initPhysics: function (data) {
      var containerBounds = sszvis.fn.measureDimensions(config.targetElement);
      var w = Math.min(containerBounds.width, config.maxChartWidth);
      state.physics = sszvis_physics(w, 200, actions.update);
      state.physics.init(data, 2010);
    },

    updatePhysics: function (data) {
      state.bubChart = actions.prepareBubbleState(state.data);
      state.canvasNeedsUpdate = true;
      var containerBounds = sszvis.fn.measureDimensions(config.targetElement);
      var w = Math.min(containerBounds.width, config.maxChartWidth);
      state.physics = sszvis_physics(w, 200, actions.update);
      state.physics.init(data, 2010);
      state.physics.setYear2(state.currentDate.getFullYear() || 2010);
      render(state);
    },

    setCanvasStatus: function (status) {
      state.canvasNeedsUpdate = status;
      render(state);
    },

    setHighlight: function (d) {
      console.log(d);
      state.bubChart.highlightData = [d];
      render(state);
    },

    resetHighlight: function () {
      state.bubChart.highlightData = [];
      render(state);
    },

    update: function () {
      render(state);
    },

    resize: function () {
      actions.updatePhysics(state.data);
    }
  };

  /* Data initialization
  ----------------------------------------------- */
  d3.csv(config.dataPath)
    .row(function (d) {
      return {
        year: sszvis.parse.number(d[config.dateColumn]),
        date: sszvis.parse.year(d[config.dateColumn]),
        category: d[config.categoryColumn],
        value: sszvis.parse.number(d[config.valueColumn])
      };
    })
    .get(function (error, data) {
      if (error) {
        sszvis.loadError(error);
        return;
      }

      var containerBounds = sszvis.fn.measureDimensions(config.targetElement);
      var w = Math.min(containerBounds.width, config.maxChartWidth);

      // PARENT CONTAINER
      // get hold of the parent container
      var parent = d3.select(config.targetElement);

      // CONTROL CONTAINER
      // append fiv for the controls (stepper) to parent div
      parent.append('div').attr('id', config.controlDivId.substring(1, config.controlDivId.length));

      // PHYSICS CONTAINER
      // append physics div to the parent div
      var physicsDiv = parent.append('div').attr('id', config.chartPhysicsId.substring(1, config.chartPhysicsId.length));

      // add padding so that stepper is clickable
      physicsDiv.style('padding-top', '93px');

      // add anchor label containers to physics div
      physicsDiv.append('div')
        .attr('id', 'sszvis-anchor-labels')
        .style('position', 'relative');

      // append overlay div on to physics div. This sits on top of canvas and is needed for display of tooltips
      physicsDiv.append('div')
        .attr('id', config.bubbleOverlayId.substring(1, config.bubbleOverlayId.length))
        .style('width', w + 'px')
        .style('height', '200px')
        .style('position', 'absolute');
      //  .style('border','1px solid black');

      // create drawing canvas in physics div
      drawingCanvas = physicsDiv.append('canvas')
        .attr('class', 'sszvis-drawing-canvas')
        .attr('width', w)
        .attr('height', 200);

      // append divs for both stacked area charts to parent div

      // STACKED AREA CHART (Bevölkerung, Geburten, Zuzüge) CONTAINER
      parent.append('div').attr('id', config.chartBevId.substring(1, config.chartBevId.length));

      // STACKED AREA CHART (WEgzüge, Todesfälle) CONTAINER
      parent.append('div').attr('id', config.chartOutId.substring(1, config.chartOutId.length));

      actions.prepareState(data);
    });

  /* Render
  ----------------------------------------------- */
  function render (state) {
    // -------- BOUNDS -----------------------------------------
    // bounds for stacked area chart (Bevölkerung, Geburten, Zuzüge)
    var bevChartInnerHeight = 100;

    var containerBounds = sszvis.fn.measureDimensions(config.targetElement);

    var w = Math.min(containerBounds.width, config.maxChartWidth);
    var boundsBev = createBounds(w, bevChartInnerHeight, 33, 30);

    // bounds for stacked area chart (Todesfälle, Wegzüge)
    // make this one a lot less hight, as there are much smaller values in this one

    // we want the second stacked bar chart smaller than the first
    var shrinkFactor = 0.25;
    var boundsOut = createBounds(w, bevChartInnerHeight * shrinkFactor, 0, 140);

    // bounds for the bubble overlay (used for tooltips on top of canvas)
    // TODO dont hardcode this 250, because this is the same height of the canvas
    var boundsBubble = createBounds(w, 250, 0, 0);

    // -------- SCALES ---------------------------------------------

    // xScale
    // mainly used for both stacked area charts
    var xScale = d3.time.scale()
      .domain(state.years)
      .range([0, boundsBev.innerWidth]);

    // yScales
    // get the next 100000er as upper limit
    var factor = 100000;
    var upperLimit = Math.ceil(state.bevChart.maxStacked / factor) * factor;

    // yScale for stacked area chart (Bevölkerung, Geburten, Zuzüge)
    var yScaleBev = d3.scale.linear()
      .domain([0, upperLimit])
      .range([boundsBev.innerHeight, 10]);

    // yScale for stacked area chart (Todesfälle, Wegzüge )
    var yScaleOut = d3.scale.linear()
      // adjust the domain of the second stacked area chart so that both are comparable
      .domain([0, upperLimit * shrinkFactor])
      .range([boundsOut.innerHeight, 10]);

    // category scale for chart colors and legends
    var cScale = d3.scale.ordinal()
      .domain(config.legendCategories)
      .range(config.legendColors);

    // rScale for the radius legend
    var rScale = d3.scale.linear()
      .domain([0, state.physics.getPeoplePerBubble()])
      .range([0, state.physics.getBubbleRadius()]);

    // -------- LAYERS ------------------------------------------

    // chart layer for the stacked area chart (Bevölkerung, Zuzüge, Geburten)
    var chartLayerBev = sszvis.createSvgLayer(config.chartBevId, boundsBev, {
      title: (''),
      description: ('')
    });

    // chart layer for the stacked area chart (Todesfälle, Wegzüge)
    var chartLayerOut = sszvis.createSvgLayer(config.chartOutId, boundsOut, {
      title: (''),
      description: ('')
    });

    // chart layer for bubble overlay, used for tooltips
    var allAnchors = state.physics.getAllAnchors();
    var chartLayerBubble = sszvis.createSvgLayer(config.bubbleOverlayId, boundsBubble, {
      title: (''),
      description: ('')
    }).datum(allAnchors);

    // for tooltips on anchors
    var tooltipLayer = sszvis.createHtmlLayer(config.bubbleOverlayId)
      .datum(state.bubChart.highlightData);

    // for stepper element on top
    var controlLayer = sszvis.createHtmlLayer(config.controlDivId);

    // ----------- COMPONENTS ----------------------------------------------

    var yearRange = state.years.map(function (y) {
      return y.getFullYear();
    });

    // CONTROLS
    var backAndForth = stepper()
      .range(yearRange)
      .value(state.currentDate.getFullYear())
      .change(function (year) {
        actions.changeDateStepper(new Date(year + ''));
      });

    // BUBBLE OVERLAY
    // used in bubble overlay for tooltips over canvas
    // the dots are invisible an used for tooltip anchors
    var dots = sszvis.component.dot()
      .x(function (d) {
        return d.x;
      })
      .y(function (d) {
        return d.y;
      })
      .radius(function (d) {
        return 10;
      })
      .fill('transparent')
      .stroke('none');

    var labelAnchors = state.physics.getLabelAnchors();
    var tooltip = sszvis.annotation.tooltip()
      .renderInto(tooltipLayer)
      .header(function (d) {
        return getHeader(d.type);
      })
      .body(function (d) {
        if (d.type === 'bestand') {
          var neugeborene = state.data.filter(function (g) {
            return xAcc(g).getFullYear() === d.year && cAcc(g) === 'Geburten';
          })[0];

          var neuzuzuge = state.data.filter(function (g) {
            return xAcc(g).getFullYear() === d.year && cAcc(g) === 'Zuzüge';
          })[0];

          return [
            ['Jahr', d.year],
            ['Gesamtbevölkerung', sszvis.format.number(d.value)],
            ['Geburten', sszvis.format.number(yAcc(neugeborene))],
            ['Zuzüge', sszvis.format.number(yAcc(neuzuzuge))]
          ];
        }
        return [
          ['Jahr', d.year],
          [getHeader(d.type), sszvis.format.number(d.value)]
        ];
      })
      .orientation(sszvis.annotation.tooltip.fit('bottom', boundsBev))
      .visible(function (d) {
        // TODO this is  a hack, make it nice!
        var contains2 = false;
        var anchors2 = labelAnchors.filter(function (d, i) {
          return i !== 2;
        });
        anchors2.forEach(function (a) {
          if (a.year === d.year) {
            contains2 = true;
          }
        });

        return contains2 && (d.value > 0) && sszvis.fn.contains(state.bubChart.highlightData, d);
      });

    // STACKED AREA CHART (Bevölkerung, Geburten, Zuzug)
    var stackedAreaBev = sszvis.component.stackedArea()
      .key(sszvis.fn.prop('category'))
      .valuesAccessor(sszvis.fn.prop('values'))
      .x(sszvis.fn.compose(xScale, xAcc))
      .yAccessor(yAcc)
      .yScale(yScaleBev)
      .fill(sszvis.fn.compose(cScale, cAcc));

    // yAxis
    var yAxisBev = sszvis.axis.y()
      .scale(yScaleBev)
      .orient('right')
      .tickValues([250000, 500000])
      .tickFormat(function (d) {
        if (d === 0) {
          return null;
        }
        return sszvis.format.number(d);
      })
      .title(config.yLabel)
      .dyTitle(-14)
      .contour(false)
      .showZeroY(false);

    // range ruler for interaction, this is the part with the labels, but no handle
    var rangeRulerBev = adaptedRangeRuler() // sszvis.annotation.rangeRuler()
      .top(yScaleBev(state.bevChart.totalHighlightValue))
      .bottom(boundsBev.innerHeight)
      .x(xScale(/* state.currentDate */ state.bevChart.highlightDate))
      .y0(function (d) {
        return yScaleBev(d.y0);
      })
      .y1(function (d) {
        return yScaleBev(d.y0 + d.y);
      })
      .label(function (d) {
        // TODO when putting a string which isnt a number, output is '-'
        // so maybe copy entire rangerule from sszvis and adapt

        return cAcc(d) + ' ' + sszvis.format.number(yAcc(d));
      })
      .totalLabel('Gesamtbevölkerung')
      .total(state.bevChart.totalHighlightValue)
      .flip(function (d) {
        return xScale(state.bevChart.highlightDate) >= 0.5 * boundsBev.innerWidth;
      });

    // STACKED AREA CHART (Wegzug, Todesfälle)
    var stackedAreaOut = sszvis.component.stackedArea()
      .key(sszvis.fn.prop('category'))
      .valuesAccessor(sszvis.fn.prop('values'))
      .x(sszvis.fn.compose(xScale, xAcc))
      .yAccessor(yAcc)
      .yScale(yScaleOut)
      .fill(sszvis.fn.compose(cScale, cAcc));

    // yAxis
    var yAxisOut = sszvis.axis.y()
      .scale(yScaleOut)
      .orient('right')
      .tickValues([100000])
      .tickFormat(function (d) {
        if (d === 0) {
          return null;
        }
        return sszvis.format.number(d);
      })
      .title('')
      .dyTitle(-20)
      .contour(false)
      .showZeroY(false);

    // range ruler for interaction in the lower stacked area chart
    var rangeRulerOut = adaptedRangeRuler() // sszvis.annotation.rangeRuler()
      .top(yScaleOut(state.outChart.totalHighlightValue))
      .bottom(boundsOut.innerHeight)
      .x(xScale(state.bevChart.highlightDate))
      .y0(function (d) {
        return yScaleOut(d.y0);
      })
      .y1(function (d) {
        return yScaleOut(d.y0 + d.y);
      })
      .label(function (d) {
        return cAcc(d) + ' ' + sszvis.format.number(yAcc(d));
      })
      .total(null)
      .totalLabel('')
      .showTotal(false)
      .flip(function (d) {
        return xScale(state.bevChart.highlightDate) >= 0.5 * boundsOut.innerWidth;
      });

    // XAXIS
    // for both stacked area charts
    var xTickValues = config.ticks ? xScale.ticks(config.ticks) : xScale.ticks(); // xScale.ticks(d3.time.year,1);

    xTickValues = xTickValues.concat(state.selection.map(xAcc));

    var xAxis = sszvis.axis.x.time()
      .scale(xScale)
      .orient('bottom')
      .tickValues(xTickValues)
      .highlightTick(isSelected)
      .title(config.xLabel);

    // LEGENDS
    // color legend
    var cLegend = sszvis.legend.ordinalColorScale()
      .scale(cScale)
      .horizontalFloat(true)
      .floatWidth(w);

    // radius Legend
    var ppb = state.physics.getPeoplePerBubble();
    var tickVals = [ppb];
    var radiusLegend = sszvis.legend.radius()
      .scale(rScale)
      .tickValues(tickVals)
      .tickFormat(function (d) {
        return d + ' Personen';
      });

    // ----- RENDERING ------------------------------------

    // render order according to layout top to bottom, order doesnt really matter, its more for clarity

    // STEPPER
    controlLayer.selectDiv('controls')
      .style('left', '1px')
      .style('top', '23px')
      .style('width', w - 2 + 'px')
      .call(backAndForth);

    // ANCHOR LABELS (years)
    var labelContainer = d3.select('#sszvis-anchor-labels')
      .style('min-height', '15px')
      .style('overflow', 'hidden')
      .style('max-width', w + 'px');

    // d3 enter, append new label divs
    labelContainer.selectAll('.anchorLabel')
      .data(labelAnchors)
      .enter()
      .append('div')
      .classed('anchorLabel', true)
      .style('position', 'absolute')
      .style('color', '#767676')
      .style('font-family', 'Arial, sans-serif')
      .style('font-size', '10px')
      .style('font-style', 'normal')
      .style('font-weight', 'normal');

    // d3 update, changing label text according to current year
    var offset = 10;
    labelContainer.selectAll('.anchorLabel')
      .data(labelAnchors)
      .style('top', function (d, i) {
        return '1px';
      })
      .style('left', function (d, i) {
        var val = d.type === 'bestand' ? (0.5 * w - offset + 0) : (d.x - offset);
        return val + 'px';
      })
      .style('visibility', function (d, i) {
        var isLastZuzug = (i === 2);
        var isLastWegzug = (i === 4);
        return (isLastZuzug || isLastWegzug) ? 'hidden' : 'visible';
      })
      .style('color', function (d) {
        if (state.grayParticles) {
          return '#eee';
        }
        return '#767676';
      })
      .text(function (d, i) {
        return d.year;
      })
      .classed('thebestand', function (d) {
        return d.type === 'bestand' ? true : false;
      });

    d3.selectAll('.thebestand')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('top', '1px');

    // INVISIBLE BUBBLE CHART (for tooltips)

    // dots
    chartLayerBubble.selectGroup('dots')
      .call(dots);

    // tooltips on dots
    chartLayerBubble.selectAll('[data-tooltip-anchor]')
      .call(tooltip);

    // STACKED AREA CHART (Bevölkerungs, Geburten, Zuzüge)

    // stacked area
    chartLayerBev.selectGroup('areachart')
      .datum(state.bevChart.stackedData)
      .call(stackedAreaBev);

    // xAxis
    chartLayerBev.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, boundsBev.innerHeight))
      .call(xAxis);

    // yAxis
    chartLayerBev.selectGroup('yAxis')
      .call(yAxisBev);

    // range ruler
    chartLayerBev.selectGroup('highlight')
      .datum(state.bevChart.highlightData)
      .call(rangeRulerBev)
      .call(separateTwoLabelsVerticalOverlap);

    // STACKED AREA CHART (Todesfälle, Wegzüge)

    // stacked area
    chartLayerOut.selectGroup('areachart')
      .datum(state.outChart.stackedData)
      .call(stackedAreaOut);

    // xAxis
    chartLayerOut.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, boundsOut.innerHeight))
      .call(xAxis);

    // yAxis
    chartLayerOut.selectGroup('yAxis')
      .call(yAxisOut);

    // range ruler
    chartLayerOut.selectGroup('highlight')
      .datum(state.outChart.highlightData)
      .call(rangeRulerOut)
      .call(separateTwoLabelsVerticalOverlap);

    // LEGENDS

    // color legend
    chartLayerOut.selectGroup('colorLegend')
    // the color legend should always be positioned 60px below the bottom axis
    .attr('transform', sszvis.svgUtils.translateString(1, boundsOut.innerHeight + 80))
      .call(cLegend);

    // radius legend, this is rendered into stacked area chart, but conceptually belongs to physics canvas
    chartLayerOut.selectGroup('radiusLegend')
      .attr('transform', sszvis.svgUtils.translateString(1, boundsOut.innerHeight + 60))
      .call(radiusLegend);

    // containerBounds.width

    // targetElement
    // chartPhysicsId
    // bubbleOverlayId
    // chartBevId
    // chartOutId
    // controlDivId

    d3.select(config.targetElement)
      .style('padding-left', Math.max(containerBounds.width / 2 - w / 2, 0) + 'px');

    // INTERACTION

    // hover interaction on stacked area charts
    var interactionLayer = sszvis.behavior.move()
      .xScale(xScale)
      .yScale(yScaleBev)
      .on('move', actions.changeDateHover)
      .on('end', actions.resetDateHover);

    chartLayerBev.selectGroup('interaction')
      .call(interactionLayer);

    chartLayerOut.selectGroup('interaction')
      .call(interactionLayer);

    if (state.canvasNeedsUpdate) {
      drawingCanvas.attr('width', w);
      actions.setCanvasStatus(false);
    }

    // mouse voronoi overlay for tooltips
    // var mouseOverlay = sszvis.behavior.voronoi()
    //   .x(function (d) {
    //     return d.x;
    //   })
    //   .y(function (d) {
    //     return d.y;
    //   })
    //   .bounds([
    //     [0, 0],
    //     [w - 20, boundsBubble.innerHeight - 50]
    //   ])
    //   .debug(true)
    //   .on('over', actions.setHighlight)
    //   .on('out', actions.resetHighlight);

    // console.log('state.bubChart.voronoiFiltered',state.bubChart.voronoiFiltered);
    // add the voronoi to the bubble chart overlay
    // chartLayerBubble.selectGroup('voronoiMouse')
    //   .datum(state.bubChart.voronoiFiltered)
    //   .call(mouseOverlay);

    // The voronoi freaked out on resize, so for now this is the easiest way to 
    // get tooltips and responsive behavior to run. 

    var bubbleTooltips = sszvis.behavior.panning()
      .elementSelector('.sszvis-circle')
      .on('start', actions.setHighlight)
      .on('pan', actions.setHighlight)
      .on('end', actions.resetHighlight);

    chartLayerBubble.call(bubbleTooltips);

    correctBestand();

    sszvis.viewport.on('resize', actions.resize);
    // debugBubbles();
  }

  // this is needed because  inconscitancies occur with bubbles being ceiled to groups of 2000
  // we need to add or remove some bestand particles
  function correctBestand () {
    var year = state.currentDate.getFullYear();
    var currYearPhysics = state.physics.getCurrentYear();

    // physics is lagging behind, so only do the check if phyiscs and d3 stacked data are on current year
    if (year !== currYearPhysics) {
      return;
    }

    var physicsData = state.physics.getDataByYear();
    var particles = state.physics.getParticles();

    var oldbevCurrYear = physicsData[year].bestandNetto;

    var estBubblesOldBev = Math.ceil(oldbevCurrYear / state.physics.getPeoplePerBubble());

    var realBubblesOldBev = particles.filter(function (p) {
      return (p.type === 'bestand') && (p.year === year);
    }).length;

    if (estBubblesOldBev === realBubblesOldBev) {
      // nothing to correct.
      return;
    }

    var diff = Math.abs(estBubblesOldBev - realBubblesOldBev);

    if (estBubblesOldBev < realBubblesOldBev) {
      // we need to remove particels

      state.physics.removeParticles('bestand', year, diff);
    } else if (estBubblesOldBev > realBubblesOldBev) {
      state.physics.addParticles('bestand', year, diff);
    }
  }

  function debugBubbles () {
    var physicsData = state.physics.getDataByYear();
    var particles = state.physics.getParticles();

    // check data of current year
    var currYear = state.currentDate.getFullYear();
    var currYearPhysics = state.physics.getCurrentYear();

    // physics is lagging behind, so only do the check if phyiscs and d3 stacked data are on current year
    if (currYear !== currYearPhysics) {
      return;
    }

    // check if years are the same
    console.assert(state.currentDate.getFullYear() === state.physics.getCurrentYear(), 'physics year and stacked data year not the same');

    var year = state.currentDate.getFullYear();

    // check wegzüge/todesfälle current year

    var wegzugCurrYear = physicsData[year].wegzug;
    var todCurrYear = physicsData[year].tod;

    console.log(physicsData[year]);
    console.log(wegzugCurrYear, todCurrYear);

    // estimates
    var estBubblesWegzug = Math.ceil(wegzugCurrYear / state.physics.getPeoplePerBubble());
    var estBubblesTod = Math.ceil(todCurrYear / state.physics.getPeoplePerBubble());

    // reality
    var realBubblesWegzug = particles.filter(function (p) {
      return (p.type === 'wegzug') && (p.year === year);
    }).length;

    var realBubblesTod = particles.filter(function (p) {
      return (p.type === 'tod') && (p.year === year);
    }).length;

    console.assert(realBubblesWegzug === estBubblesWegzug, 'wrong number of bubbles for wegzug ' + year + '. Expected: ' + estBubblesWegzug + ' Got: ' + realBubblesWegzug);
    console.assert(realBubblesTod === estBubblesTod, 'wrong number of bubbles for tod ' + year + ' Expected: ' + estBubblesTod + ' Got: ' + realBubblesTod);

    // check bevölkerung current year

    var oldbevCurrYear = physicsData[year].bestandNetto;
    var totalBestandCurrYear = physicsData[year].bestand;
    var zuzugCurrentYear = physicsData[year].zuzug;
    var geburtCurrentYear = physicsData[year].geburt;

    var estBubblesOldBev = Math.ceil(oldbevCurrYear / state.physics.getPeoplePerBubble());
    var estBubblesZuzug = Math.ceil(zuzugCurrentYear / state.physics.getPeoplePerBubble());
    var estBubblesGeburt = Math.ceil(geburtCurrentYear / state.physics.getPeoplePerBubble());

    var realBubblesOldBev = particles.filter(function (p) {
      return (p.type === 'bestand') && (p.year === year);
    }).length;

    var realBubblesZuzug = particles.filter(function (p) {
      return (p.type === 'zuzug') && (p.year === year);
    }).length;

    var realBubblesGeburt = particles.filter(function (p) {
      return (p.type === 'geburt') && (p.year === year);
    }).length;

    console.assert(estBubblesOldBev === realBubblesOldBev, 'wrong nr of bubbles old bev expected: ' + estBubblesOldBev + ' Got: ' + realBubblesOldBev);
    console.assert(estBubblesZuzug === realBubblesZuzug, 'wrong nr of bubbles zuzug ' + ' expected: ' + estBubblesZuzug + ' Got: ' + realBubblesZuzug);
    console.assert(estBubblesGeburt === realBubblesGeburt, 'wrong nr of bubbles geburt' + ' expected: ' + estBubblesGeburt + ' Got: ' + realBubblesGeburt);

    console.log('================');
    console.log('year: ' + year);
    console.log('bisherige: bubbles: ' + realBubblesOldBev + ' Anzahl: ' + oldbevCurrYear + ' Bubbles*2000: ' + realBubblesOldBev * 2000);
    console.log('neugeborene: bubbles: ' + realBubblesGeburt + ' Anzahl: ' + geburtCurrentYear + ' Bubbles*2000: ' + realBubblesGeburt * 2000);
    console.log('zugezogene: bubbles: ' + realBubblesZuzug + ' Anzahl: ' + zuzugCurrentYear + ' Bubbles*2000: ' + realBubblesZuzug * 2000);
    console.log('----------------');
    console.log('gestorbene: bubbles: ' + realBubblesTod + ' Anzahl: ' + todCurrYear + ' Bubbles*2000: ' + realBubblesTod * 2000);
    console.log('weggezogene: bubbles: ' + realBubblesWegzug + ' Anzahl: ' + wegzugCurrYear + ' Bubbles*2000: ' + realBubblesWegzug * 2000);
    console.log('-------------');
    var bubblesBestand = realBubblesOldBev + realBubblesGeburt + realBubblesZuzug;
    console.log('Gesamtbevölkerung: bubbles ' + bubblesBestand + ' Anzahl: ' + totalBestandCurrYear + ' Bubbles*2000: ' + bubblesBestand * 2000);

    console.log('================');
  }

  /* Helper functions
  ----------------------------------------------- */

  // Stepper Component
  function stepper () {
    return d3.component()
      .prop('range').range([1993, 2015])
      .prop('value').value(2015)
      .prop('width').width(34)
      // .prop('callback')
      .prop('change').change(sszvis.fn.identity)
      .render(function () {
        var selection = d3.select(this);
        var props = selection.props();

        var container = selection.selectDiv('input');

        container.classed('sszvis-control-buttonGroup', true);
        var bt = container.selectAll('.sszvis-control-buttonGroup__item').data([0, 1]);

        // this is dirty, but otherwise it wouldn't render the buttons again (bt.exit().remove() doesn't work)
        bt.remove();
        bt = container.selectAll('.sszvis-control-buttonGroup__item').data([0, 1]);

        // console.log(bt)
        bt.enter()
          .append('div')
          .classed('sszvis-control-buttonGroup__item', true);

        bt.exit().remove();

        bt.style('width', props.width + 'px')
          .style('padding', '0')
          .style('cursor', function (d) {
            //   console.log("jo")
            if ((d && props.value === props.range[1]) || (!d && props.value === props.range[0])) {
              return 'default';
            }
            return 'pointer';
          })

        .on('click', function (d) {
          if (d && (d.value > props.range[1] || d.value < props.range[0])) {
            console.log('aborting 1 ');
            return;
          }

          var change = d ? 1 : -1;

          props.value = constrain(props.value + change, props.range[0], props.range[1]);

          props.change(props.value);
        })
          .on('mouseover', function () {
            d3.select(this).style('background-color', '#FAFAFA');
          })
          .on('mouseout', function () {
            bt.style('background-color', '');
          })
          .append('img')
          .attr('src', function (d) {
            if (!d) {
              return 'data:image/svg+xml,%3Csvg%20width%3D%2234px%22%20height%3D%2230px%22%20version%3D%221.1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%3E%3Cpath%20d%3D%22M19%2C11%20L15%2C16%20L19%2C21%22%20stroke%3D%22' + (props.value === props.range[0] ? 'rgb(219%2C219%2C219)' : '%23767676') + '%22%20cursor%3D%22inherit%22%20stroke-width%3D%221%22%20fill%3D%22none%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
            }
            return 'data:image/svg+xml,%3Csvg%20width%3D%2234px%22%20height%3D%2230px%22%20version%3D%221.1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%3E%3Cpath%20d%3D%22M15%2C11%20L19%2C16%20L15%2C21%22%20stroke%3D%22' + (props.value === props.range[1] ? 'rgb(219%2C219%2C219)' : '%23767676') + '%22%20cursor%3D%22inherit%22%20stroke-width%3D%221%22%20fill%3D%22none%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
          });
      });
  }

  function closestDatum (data, accessor, datum) {
    var i = d3.bisector(accessor).left(data, datum, 1);
    var d0 = data[i - 1];
    var d1 = data[i] || d0;
    return datum - accessor(d0) > accessor(d1) - datum ? d1 : d0;
  }

  function isSelected (d) {
    return sszvis.fn.contains(state.selection.map(xAcc).map(String), String(d));
  }

  // DRAWING FUNCTIONS

  function drawParticles (ctx, parts) {
    parts.forEach(function (p) {
      drawParticle(ctx, p);
    });
  }

  function drawParticle (ctx, p) {
    fill(ctx, 'black');

    var pos = p.getPos();

    var yr = p.year;
    var currYear = state.physics.getCurrentYear();
    var yearDiff = Math.abs(yr - currYear);
    var alph = yearDiff > 0 ? 0.5 : 1;

    var col = config.colors[transType(p.type)];
    var colString = rgbString(col.rgb.r, col.rgb.g, col.rgb.b, alph);

    fill(ctx, colString);
    stroke(ctx, 'white');

    circle(ctx, pos.x, pos.y, p.radius);
  }

  function updatePhysics () {
    var ctx = drawingCanvas.node().getContext('2d');
    drawPhysics(ctx, state.physics);
  }

  function drawPhysics (ctx, _phys) {
    // update physics
    _phys.update();

    // draw background
    fill(ctx, 'white');

    // TODO somehow get this width differently
    rect(ctx, 0, 0, drawingCanvas.node().width, drawingCanvas.node().height);

    // draw particles
    var particles = _phys.getParticles();

    drawParticles(ctx, particles);

    if (config.displayFps) {
      var now = Date.now();
      var frameRate = 1000.0 / (now - lastFrameTime);
      lastFrameTime = now;

      fill(ctx, 'black');
      text(ctx, 'fps: ' + frameRate.toFixed(0), 50, 20);
    }
  }

  function fill (ctx, col) {
    ctx.fillStyle = col;
  }

  function stroke (ctx, col) {
    ctx.strokeStyle = col;
  }

  function circle (ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function rect (ctx, x, y, w, h) {
    ctx.fillRect(x, y, w, h);
  }

  function text (ctx, s, x, y) {
    ctx.font = '12px Arial';
    ctx.fillText(s, x, y);
  }

  // TODO create lookup for this
  function getHeader (type) {
    switch (type) {
      case 'geburt':
        return 'Geburten';
      case 'tod':
        return 'Todesfälle';
      case 'zuzug':
        return 'Zuzüge';
      case 'wegzug':
        return 'Wegzüge';
      case 'bestand':
        return 'Bevölkerung';
      default:
        return type;
    }
  }

  function createBounds (_width, _innerHeight, _top, _bottom) {
    return sszvis.bounds({
      top: _top,
      bottom: _bottom,
      height: _top + _innerHeight + _bottom,
      width: _width
    }, config.targetElement);
  }

  function adaptedRangeRuler () {
    return d3.component()
      .prop('x', d3.functor)
      .prop('y0', d3.functor)
      .prop('y1', d3.functor)
      .prop('top')
      .prop('bottom')
      .prop('label').label(d3.functor(''))
      .prop('totalLabel').totalLabel(d3.functor(''))
      .prop('total')
      .prop('showTotal').showTotal(true)
      .prop('flip', d3.functor).flip(false)
      .render(function (data) {
        var selection = d3.select(this);
        var props = selection.props();

        var crispX = sszvis.fn.compose(sszvis.svgUtils.crisp.halfPixel, props.x);
        var crispY0 = sszvis.fn.compose(sszvis.svgUtils.crisp.halfPixel, props.y0);
        var crispY1 = sszvis.fn.compose(sszvis.svgUtils.crisp.halfPixel, props.y1);
        var middleY = function (d) {
          return sszvis.svgUtils.crisp.halfPixel((props.y0(d) + props.y1(d)) / 2);
        };

        var dotRadius = 1.5;

        var line = selection.selectAll('.sszvis-rangeRuler__rule')
          .data([0]);

        line.enter()
          .append('line')
          .classed('sszvis-rangeRuler__rule', true);

        line.exit().remove();

        line
          .attr('x1', crispX)
          .attr('y1', props.top)
          .attr('x2', crispX)
          .attr('y2', props.bottom);

        var marks = selection.selectAll('.sszvis-rangeRuler--mark')
          .data(data);

        var enteringMarks = marks.enter()
          .append('g')
          .classed('sszvis-rangeRuler--mark', true);

        marks.exit().remove();

        enteringMarks.append('circle').classed('sszvis-rangeRuler__p1', true);
        enteringMarks.append('circle').classed('sszvis-rangeRuler__p2', true);
        enteringMarks.append('text').classed('sszvis-rangeRuler__label', true);

        marks.selectAll('.sszvis-rangeRuler__p1')
          .data(function (d) {
            return [d];
          })
          .attr('cx', crispX)
          .attr('cy', crispY0)
          .attr('r', dotRadius);

        marks.selectAll('.sszvis-rangeRuler__p2')
          .data(function (d) {
            return [d];
          })
          .attr('cx', crispX)
          .attr('cy', crispY1)
          .attr('r', dotRadius);

        marks.selectAll('.sszvis-rangeRuler__label')
          .data(function (d) {
            return [d];
          })
          .attr('x', function (d) {
            var offset = props.flip(d) ? -10 : 10;
            return crispX(d) + offset;
          })
          .attr('y', middleY)
          .attr('dy', '0.35em') // vertically-center
        .style('text-anchor', function (d) {
          return props.flip(d) ? 'end' : 'start';
        })
          .text(/* sszvis.fn.compose(sszvis.format.number, props.label) */ props.label);

        var total = selection.selectAll('.sszvis-rangeRuler__total')
          .data([sszvis.fn.last(data)]);

        total.enter()
          .append('text')
          .classed('sszvis-rangeRuler__total', true);

        total.exit().remove();

        total
          .attr('x', function (d) {
            var offset = props.flip(d) ? -10 : 10;
            return crispX(d) + offset;
          })
          .attr('y', props.top - 10)
          .style('text-anchor', function (d) {
            return props.flip(d) ? 'end' : 'start';
          })
          .text(function (d) {
            return props.showTotal ? props.totalLabel + ' ' + sszvis.format.number(props.total) : '';
          });
      });
  }

  function separateTwoLabelsVerticalOverlap (g) {
    var THRESHOLD = -3;
    var labelBounds = [];

    // Calculate bounds
    g.selectAll('.sszvis-rangeRuler__label').each(function (d, i) {
      var bounds = this.getBoundingClientRect();

      labelBounds.push({
        category: cAcc(d),
        top: bounds.top,
        bottom: bounds.bottom,
        dy: 0
      });
    });

    // Sort by vertical position (only supports labels of same height)
    labelBounds = labelBounds.sort(function (a, b) {
      return d3.ascending(a.top, b.top);
    });

    // console.log('labelBounds after sort',labelBounds);

    // Calculate overlap and correct position
    for (var i = 0; i < 10; i++) {
      for (var j = 0; j < labelBounds.length; j++) {
        for (var k = j + 1; k < labelBounds.length; k++) {
          if (j === k) continue;
          var firstLabel = labelBounds[j];
          var secondLabel = labelBounds[k];
          var overlap = secondLabel.top - firstLabel.bottom;
          // console.log('overlap',overlap,'firstLabel.cate',firstLabel.category,'secondLabel.cat',secondLabel.category);
          if (overlap < THRESHOLD) {
            var correction = 0.5 * Math.abs(overlap);
            firstLabel.bottom -= correction;
            firstLabel.top -= correction;
            firstLabel.dy -= correction;
            secondLabel.bottom += correction;
            secondLabel.top += correction;
            secondLabel.dy += correction;
          }
        }
      }
    }

    // Shift vertically to remove overlap
    g.selectAll('.sszvis-rangeRuler__label').each(function (d) {
      var label = sszvis.fn.find(function (l) {
        return l.category === cAcc(d);
      }, labelBounds);
      if (label) {
        var y = sszvis.parse.number(d3.select(this).attr('y'));
        var dy = label.dy;
        var newY = y + dy;

        d3.select(this)
          .attr('y', newY);
      }
    });
  }

  function constrain (n, low, high) {
    return Math.max(Math.min(n, high), low);
  }

  function colorLookup (_categories, _hexcolors) {
    var lookup = [];
    _categories.forEach(function (cat, i) {
      var colobj = {
        hex: _hexcolors[i],
        rgb: d3.rgb(_hexcolors[i])
      };
      lookup[cat] = colobj;
    });
    return lookup;
  }

  function transType (_type) {
    switch (_type) {
      case state.physics.TYPE_GEBURT:
        return 'Geburten';
      case state.physics.TYPE_TOD:
        return 'Todesfälle';
      case state.physics.TYPE_BESTAND:
        return 'Basisbevölkerung'; // return 'Bevölkerung';
      case state.physics.TYPE_WEGZUG:
        return 'Wegzüge';
      case state.physics.TYPE_ZUZUG:
        return 'Zuzüge';
      default:
        return 'Invalid';
    }
  }

  function rgbString (r, g, b, a) {
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
}(d3, sszvis, BEV460V4600Params));
