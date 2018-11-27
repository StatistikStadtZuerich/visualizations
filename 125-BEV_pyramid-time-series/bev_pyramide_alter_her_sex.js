(function(d3, sszvis, bev_pyramide_alter_her_sexParams) {
  'use strict';

  // PATCH
  // This patches sszvis.js to work with numbers that use mathematical notation.
  // The current parser can't deal with mathematical notation (e.g. "1.57e-10").
  // Because this functionality will be removed in the next SSZVIS version we fix
  // it directly here.
  //
  // IMPORTANT: Do not copy this to other examples unless you really need it.
  sszvis.svgUtils.crisp.transformTranslateSubpixelShift = function(transformStr) {
    var roundNumber = sszvis.fn.compose(Math.floor, Number);
    // var m = transformStr.match(/(translate\()\s*([0-9.,\- ]+)\s*(\))/i); // Faulty line
    var m = transformStr.match(/(translate\()\s*([0-9.,\-e ]+)\s*(\))/i);   // Patched line
    var vec = m[2]
      .replace(',', ' ')
      .replace(/\s+/, ' ')
      .split(' ')
      .map(Number);

    if (vec.length === 1) vec.push([0]);

    var vecRound = vec.map(roundNumber);
    return [vec[0] - vecRound[0], vec[1] - vecRound[1]];
  };

  // ---------------------------------------------------------------------------

  if (sszvis.fallback.unsupported()) {
    sszvis.fallback.render(config.targetElement);
    return;
  }


  /* Configuration
  ----------------------------------------------- */
  var config = {
    // The path to the CSV file containing the data for this chart
    dataPath: bev_pyramide_alter_her_sexParams.data,
    // The title and description of this chart for visually impaired users
    title: bev_pyramide_alter_her_sexParams.title,
    description: bev_pyramide_alter_her_sexParams.description,
    fallback: false,
    targetElement: bev_pyramide_alter_her_sexParams.id

  };

  var queryProps = sszvis.responsiveProps()
    .prop('tooltipAnchor', {
      palm: [0.0, 0.5],
      _: [0.5, 0.5]
    })
    .prop('tooltipOrientation', {
      palm: 'bottom',
      _: 'left'
    })
    .prop('bottomPadding', {
      lap: 150,
      _: 100
    })
    .prop('numLegendRows', {
      lap: 4,
      _: 2
    })
    .prop('controlWidth', {
      _: function(width) {
        return Math.min(width, 300);
      }
    });


  /* Shortcuts
  ----------------------------------------------- */
  var vAcc = sszvis.fn.prop('value');
  var gAcc = sszvis.fn.prop('gender');
  var aAcc = sszvis.fn.prop('age');
  var cAcc = sszvis.fn.prop('category');
  var stackAcc = sszvis.fn.prop('group');
  var womenAcc = sszvis.fn.prop('Weiblich');
  var menAcc = sszvis.fn.prop('Männlich');


  /* Application state
  ----------------------------------------------- */
  var state = {
    data: [],
    ages: [],
    ageExtent: [0, 0],
    groups: [],
    populations: {},
    binnedData: [],
    maxStackedValue: 0,
    categories: [],
    selectedCategory: null,
    selectedBar: null
  };


  /* State transitions
  ----------------------------------------------- */
  var actions = {
    prepareState: function(data) {
      state.data = data;
      state.ages = sszvis.fn.set(state.data, aAcc);
      state.ageExtent = d3.extent(state.ages);

      state.categories = sszvis.fn.set(state.data, cAcc);
      state.selectedCategory = state.categories[0];

      actions.recomputeStateAndRender();
    },


    selectCategory: function(category) {
      state.selectedCategory = category;
      actions.recomputeStateAndRender();
    },

    selectBar: function(x, rawAge) {
      var age = Math.floor(rawAge);
      var rows = Object.keys(state.populations).reduce(function(acc, k) {
        state.populations[k].forEach(function (groupData) {
          acc = acc.concat(groupData.filter(function(d) { return d.age === age; }));
        });
        return acc;
      }, []);
      state.selectedBar = {
        age: age,
        rows: rows
      };
      render(state);
    },

    deselectBar: function () {
      state.selectedBar = null;
      render(state);
    },

    recomputeStateAndRender: function() {
      state.binnedData = state.data.filter(function(d) {
        return cAcc(d) === state.selectedCategory;
      });

      state.groups = sszvis.fn.set(state.binnedData, groupAndStackAcc);

      state.populations = sszvis.cascade()
        .objectBy(gAcc)
        .arrayBy(stackAcc)
        .apply(state.binnedData);

      state.maxStackedValue = d3.max(d3.values(state.populations), function(stacks) {
        return d3.max(d3.transpose(stacks), function(s) { return d3.sum(s, vAcc); });
      });

      render(state);
    },

    resize: function() { render(state); }
  };


  /* Data initialization
  ----------------------------------------------- */
  d3.csv(config.dataPath)
    .row(function(d) {
      return {
        age: sszvis.parse.number(d['AlterVSort']),
        gender: d['Geschlecht'],
        group: d['Herkunft'],
        value: sszvis.parse.number(d['Anzahl']),
        category: d['Kategorie']
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
    var chartDimensions = sszvis.fn.measureDimensions(config.targetElement);

    var props = queryProps(chartDimensions);
    var pyramidDimensions = sszvis.layout.populationPyramidLayout(chartDimensions.width - 2, state.ages.length);

    var chartPadding = { top: 90, bottom: props.bottomPadding };

    var bounds = sszvis.bounds({ height: chartPadding.top + pyramidDimensions.totalHeight + chartPadding.bottom, top: chartPadding.top, bottom: chartPadding.bottom, left: pyramidDimensions.chartPadding, right: pyramidDimensions.chartPadding }, config.targetElement);


    // Scales

    var lengthScale = d3.scale.linear()
      .domain([0, state.maxStackedValue])
      .range([0, pyramidDimensions.maxBarLength]);

    var positionScale = d3.scale.ordinal()
      .domain(state.ages)
      .range(pyramidDimensions.positions);

    var colorScale = colScale()
      .domain(state.groups);


    // Layers

    var chartLayer = sszvis.createSvgLayer(config.targetElement, bounds, {
        title: "",
        description: ""
      })
      .datum(state.populations);

    var htmlLayer = sszvis.createHtmlLayer(config.targetElement, bounds);

    var controlsLayer = htmlLayer.selectDiv('controls');

    var tooltipLayer = htmlLayer.selectDiv('tooltip')
      .datum(state.selectedBar);


    // Components

    var control = sszvis.control.buttonGroup()
      .values(state.categories)
      .width(props.controlWidth)
      .current(state.selectedCategory)
      .change(actions.selectCategory);

    var pyramid = sszvis.component.stackedPyramid()
      .barFill(sszvis.fn.compose(colorScale, groupAndStackAcc))
      .barPosition(sszvis.fn.compose(positionScale, aAcc))
      .barHeight(pyramidDimensions.barHeight)
      .barWidth(sszvis.fn.compose(lengthScale, vAcc))
      .tooltipAnchor(props.tooltipAnchor)
      .leftAccessor(womenAcc)
      .rightAccessor(menAcc);

    var xAxis = sszvis.axis.x.pyramid()
      .scale(lengthScale)
      .orient('bottom')
      .title('Anzahl')
      .titleAnchor('middle')
      .titleCenter(true);

    var yAxis = sszvis.axis.y.ordinal()
      .scale(positionScale)
      .orient('right')
      .tickFormat(function(d) {
        return (d === 0) ? '' : sszvis.format.age(d);
      })
      .ticks(5)
      .title('Alter in Jahren')
      .dyTitle(-18);

    var colorLegend = sszvis.legend.ordinalColorScale()
      .scale(colorScale)
      .orientation('vertical')
      .rows(props.numLegendRows)
      .columnWidth(Math.min(bounds.innerWidth / 2, 300));

    var tooltip = sszvis.annotation.tooltip()
      .renderInto(tooltipLayer)
      .header(function(d) {
        return aAcc(d) + '-jährige';
      })
      .body(function() {
        return state.selectedBar.rows.map(function(r) {
          var label = "" + gAcc(r) + " (" + stackAcc(r) + ")";
          return [label, sszvis.format.number(vAcc(r))];
        });
      })
      .orientation(props.tooltipOrientation)
      .visible(function(d) {
        return state.selectedBar
            && state.selectedBar.age === aAcc(d)
            && gAcc(d) === 'Männlich'
            && stackAcc(d) === 'Schweiz';
      });


    // Rendering

    chartLayer.selectGroup('populationPyramid')
      .datum(state.populations)
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth / 2, 0))
      .call(pyramid);

    chartLayer.selectAll('[data-tooltip-anchor]')
      .call(tooltip);

    chartLayer.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth / 2, bounds.innerHeight))
      .call(xAxis);

    chartLayer.selectGroup('yAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, 0))
      .call(yAxis);

    chartLayer.selectGroup('colorLegend')
      .attr('transform', sszvis.svgUtils.translateString(0, bounds.innerHeight + 60))
      .call(colorLegend);

    controlsLayer
      .style('left', ((bounds.innerWidth - props.controlWidth) / 2) + 'px')
      .style('top', (20 - bounds.padding.top) + 'px')
      .call(control);

    // Interaction

    var mouseXScale = d3.scale.linear().domain([0, 1]).range([0, bounds.innerWidth]);
    // using a continuous linear scale for the y mouse position ensures that the tooltip doesn't flicker on and off
    // if we were to use an ordinal scale, the tooltip would disappear while the mouse is in the spaces
    // between the bars, because the ordinal scale has no value there, while a linear scale does.
    var mouseYScale = d3.scale.linear().domain(state.ageExtent).range([bounds.innerHeight, 0]);
    var interactionLayer = sszvis.behavior.move()
      .xScale(mouseXScale)
      .yScale(mouseYScale)
      .cancelScrolling(isWithinBarContour(state.binnedData, bounds.innerWidth/2, mouseXScale, lengthScale))
      .fireOnPanOnly(true)
      .on('move', actions.selectBar)
      .on('end', actions.deselectBar);

    chartLayer.selectGroup('interactionLayer')
      .call(interactionLayer);

    sszvis.viewport.on('resize', actions.resize);
  }


  /* Helper functions
  ----------------------------------------------- */
  function groupAndStackAcc(d) {
    return gAcc(d) + ' (' + stackAcc(d) + ')';
  }

  function isWithinBarContour(binnedData, xCenter, xRelToPx, lengthScale) {
    return function(xRel, rawAge) {
      var ageBin = Math.round(rawAge);
      var dataRow = binnedData.filter(function(d){ return aAcc(d) === ageBin; });
      var x = xRelToPx(xRel);

      var minMax = dataRow.reduce(function(acc, d) {
        gAcc(d) === 'Weiblich' ? acc.left -= lengthScale(vAcc(d)) : acc.right += lengthScale(vAcc(d))
        return acc;
      }, {left: xCenter, right: xCenter});

      return Math.abs(xCenter - x) <= 20 || (x >= minMax.left && x <= minMax.right);
    }
  }

  function colScale () {

    return d3.scale.ordinal().range(['#CC6788', '#E6B7C7', '#5182B3', '#B8CFE6']);
  }


}(d3, sszvis, bev_pyramide_alter_her_sexParams));