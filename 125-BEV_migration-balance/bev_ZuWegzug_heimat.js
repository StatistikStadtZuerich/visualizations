
(function(d3, sszvis, bev_ZuWegzug_heimatParams) {
  'use strict';

  if (sszvis.fallback.unsupported()) {
    sszvis.fallback.render(config.targetElement);
    return;
  }


  /* Configuration
  ----------------------------------------------- */
  var config = {
    dataPath: bev_ZuWegzug_heimatParams.data, //optional
    title: bev_ZuWegzug_heimatParams.title, //optional
    description: bev_ZuWegzug_heimatParams.description, //optional
    fallback: false, //optional, creates long ticks when true
    targetElement: bev_ZuWegzug_heimatParams.id
  }


  var TITLE = '';
  var DESCRIPTION = '';
  var MAX_WIDTH = 800;

  /* Shortcuts
  ----------------------------------------------- */
  var xAcc = sszvis.fn.prop('region');
  var yAcc = sszvis.fn.prop('value');
  var cAcc = sszvis.fn.prop('category');


  /* Application state
  ----------------------------------------------- */
  var state = {
    data: [],
    years: [],
    valueExtent: [0, 0],
    groups: [],
    groupedData: [],
    longestGroup: 0,
    selection: []
  };


  /* State transitions
  ----------------------------------------------- */
  var actions = {
    prepareState: function(data) {
      state.data = data;
      state.regions = sszvis.fn.set(state.data, xAcc);
      state.valueExtent = d3.extent(state.data, yAcc);
      state.groups = sszvis.fn.set(state.data, cAcc);
      state.groupedData = sszvis.cascade()
        .arrayBy(xAcc)
        .apply(state.data);
      state.longestGroup = d3.max(state.groupedData, sszvis.fn.prop('length'));

      render(state);
    },

    showTooltip: function(x, y) {
      state.selection = state.groupedData.filter(function(d) {
        return sszvis.fn.contains(d.map(xAcc), x);
      });
      render(state);
    },

    hideTooltip: function(x, y) {
      state.selection = [];
      render(state);
    },

    resize: function() { render(state); }
  };


  /* Data initialization
  ----------------------------------------------- */
  d3.csv(config.dataPath)
    .row(function(d) {
      return {
        region: d['Jahrzehnt'],
        category: d['HerkunftLang'],
        value: sszvis.parse.number(d['Migrationssaldo'])
      };
    })
    .get(function(error, data) {
      if (error) {
        sszvis.loadError(error);
        return;
      }
      actions.prepareState(data);
    });


  /* Render
  ----------------------------------------------- */
  function render(state) {
    var bounds = sszvis.bounds({ top: 30, bottom: 130 }, config.targetElement);
    var chartWidth = Math.min(MAX_WIDTH, bounds.innerWidth);

    // Scales

    var xScale = d3.scale.ordinal()
      .domain(state.regions)
      .rangeRoundBands([0, chartWidth], 0.26, 0.80);

    // because the bar chart must display negative values, scales for the y-axis are a little weird
    // see also: http://bl.ocks.org/mbostock/2368837 (http://stackoverflow.com/questions/10127402/bar-chart-with-negative-values)
    var yScale = d3.scale.linear()
      .domain([-5000, 5000])
      .range([bounds.innerHeight, 0]);

    var yPosScale = function(v) {
      return isNaN(v) ? yScale(0) : yScale(Math.max(v, 0));
    };

    var hScale = function(v) {
      // the size of the bar is distance from the y-position of the value to the y-position of 0
      return Math.abs(yScale(v) - yScale(0));
    };

    var genderScale = ['#CC6171','#3B76B3'];

    var cScale = d3.scale.ordinal()
      .domain(state.groups)
      .range(genderScale);
    

    // Layers

    var chartLayer = sszvis.createSvgLayer(config.targetElement, bounds, {
        title: '',
        description: ''
      })
      .datum(state.groupedData);

    var tooltipLayer = sszvis.createHtmlLayer(config.targetElement, bounds)
      .datum(state.selection);


    // Components

    var barLayout = sszvis.component.groupedBars()
      .groupScale(sszvis.fn.compose(xScale, xAcc))
      .groupWidth(xScale.rangeBand())
      .groupSize(state.longestGroup)
      .y(sszvis.fn.compose(yPosScale, yAcc))
      .height(sszvis.fn.compose(hScale, yAcc))
      .fill(sszvis.fn.compose(cScale, cAcc))
      .defined(sszvis.fn.compose(sszvis.fn.not(isNaN), yAcc));

    var xAxis = sszvis.axis.x.ordinal()
      .scale(xScale)
      .orient('bottom')
      .slant('diagonal')
      .highlightTick(function(d) {
        return sszvis.fn.contains(state.selection.map(sszvis.fn.compose(xAcc, sszvis.fn.first)), d);
      })
      .title('Jahr');

    var yAxis = sszvis.axis.y()
      .scale(yScale)
      .showZeroY(true)
      .orient('right')
      .ticks(8)
      .title('Wanderungssaldo (Mittel pro Jahr)')
      .dyTitle(-20);

    var colorLegend = sszvis.legend.ordinalColorScale()
      .scale(cScale)
      .horizontalFloat(true);

    var tooltip = sszvis.annotation.tooltip()
      .renderInto(tooltipLayer)
      .orientation(sszvis.annotation.tooltip.fit('bottom', bounds))
      .header(sszvis.svgUtils.modularText.html().bold(function(d) {
        return xAcc(sszvis.fn.first(d));
      }))
      .body(function(d) {
        // generates a row from each data element
        return d.map(function(item) {
          var v = yAcc(item);
          return [cAcc(item), isNaN(v) ? '–' : v];
        });
      })
      .visible(function(d) {
        return state.selection.indexOf(d) >= 0;
      });


    // Rendering

    chartLayer
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth/2 - chartWidth/2, bounds.padding.top));

    var bars = chartLayer.selectGroup('bars')
      .call(barLayout);

    bars.selectAll('[data-tooltip-anchor]')
      .call(tooltip);

    chartLayer.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, bounds.innerHeight))
      .call(xAxis);

    chartLayer.selectGroup('yAxis')
      .call(yAxis);

    chartLayer.selectGroup('colorLegend')
      .attr('transform', sszvis.svgUtils.translateString(0, bounds.innerHeight + 80))
      .call(colorLegend);


    // Interaction
    var interactionLayer = sszvis.behavior.move()
      .xScale(xScale)
      .yScale(yScale)
      .cancelScrolling(isWithinBarContour)
      .fireOnPanOnly(true)
      .on('move', actions.showTooltip)
      .on('end', actions.hideTooltip);

    chartLayer.selectGroup('interactionLayer')
      .call(interactionLayer);

    sszvis.viewport.on('resize', actions.resize);
  }

  function isWithinBarContour(category, yValue) {
    var barGroup = sszvis.fn.find(function(g) {
      return xAcc(g[0]) === category;
    }, state.groupedData);
    var cursorAbs = Math.abs(yValue);
    var absThreshold = 2;
    return barGroup && sszvis.fn.some(function(d) {
      if (!sszvis.fn.defined(d)) { return false; }
      var dataValue = yAcc(d);
      if (isNaN(dataValue) && cursorAbs < absThreshold) { return true; }
      if (Math.abs(dataValue) < absThreshold && cursorAbs < absThreshold) { return true; }
      if (dataValue < 0) {
        return yValue < 0 && yValue > dataValue;
      } else {
        return yValue >= 0 && yValue < dataValue;
      }
      // return sszvis.behavior.util.testBarThreshold(cursorAbs, d, sszvis.fn.compose(Math.abs, yAcc), 3);
    }, barGroup);
  }

}(d3, sszvis, bev_ZuWegzug_heimatParams));
