(function(d3, sszvis, bev_pyramide_alter_anteilParams) {
  'use strict';


  /* Configuration
  ----------------------------------------------- */
  var config = {
    // The path to the CSV file containing the data for this chart
    dataPath: bev_pyramide_alter_anteilParams.data,
    // The title and description of this chart for visually impaired users
    title: bev_pyramide_alter_anteilParams.title,
    description: bev_pyramide_alter_anteilParams.description,
    // Data column to use for the x-axis
    ageColumn: 'Alter',
    // Data column to use for the y-axis
    valueColumn: 'Anzahl',
    //Data column to use for the categories, here always male and female
    genderColumn: 'Geschlecht',
    yearColumn: 'Jahr',
    categoryColumn: 'Kategorie',
    // The category to use for the left and right side of the chart
    leftCategory: '',
    rightCategory: '',
    // The number of age categories to group into one bar
    groupSize: 1,
    // The label for the x-axis. Set to empty ('') to hide the label
    xAxisLabel: 'Anteil an der Gesamtbevölkerung in %',
    // The label for the y-axis. Required as it is also the label in the tooltip
    yAxisLabel: 'Alter',
    // Number of ticks on the x- and y-axis. Replace null with a cardinal number to specify the number of ticks
    xTicks: 5,
    yTicks: 10,
    // Padding between legend and x-axis in pixels. The recommended default is 60px.
    legendPadding: 60,
    //View of the chart when interactivity is not available. Creates vertical lines for the x-ticks and does not render mouse interaction when true
    fallback: false,
    targetElement: bev_pyramide_alter_anteilParams.id

  };
  var MAX_CONTROL_WIDTH = 300;
  var queryProps = sszvis.responsiveProps()
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
        return Math.min(width, MAX_CONTROL_WIDTH);
        return Math.max(420, Math.min(MAX_CONTROL_WIDTH, width / 2));
      }
    })
    .prop('tooltipAnchor', {
      palm: [0.0, 0.5],
      _: [0.5, 0.5]
    })
    .prop('control', {
       palm: function(width) {
         return sszvis.control.select;
       },
       _: function(width) {
         return sszvis.control.buttonGroup;
       }
     })
    .prop('tooltipOrientation', {
      palm: 'bottom',
      _: 'left'
    });

  if (sszvis.fallback.unsupported()) {
    sszvis.fallback.render(config.targetElement);
    return;
  }

  var genderScale = d3.scale.ordinal()
    .range(['#6493C6', '#D98490']);



  /* Shortcuts
  ----------------------------------------------- */
  var aAcc = sszvis.fn.prop('age');
  var vAcc = sszvis.fn.prop('value');
  var gAcc = sszvis.fn.prop('gender');
  var yAcc = sszvis.fn.prop('year');
  var cAcc = sszvis.fn.prop('category');
  var womenAcc = sszvis.fn.prop('weiblich');
  var menAcc = sszvis.fn.prop('männlich');
  var szenAcc = sszvis.fn.prop('Szenarien');
  var bestAcc = sszvis.fn.prop('Bestand');


  /* Application state
  ----------------------------------------------- */
  var state = {
    data: [],
    ages: [],
    ageExtent: [],
    groups: [],
    maxValue: 0,
    populations: {},
    selectedAge: [],
    years: [],
    selectedYear: null,
    referenceOrigin: null
  };


  /* State transitions
  ----------------------------------------------- */
  var actions = {
    prepareState: function(data) {

      state.rawData = data;


      //remove the ones which are of category Bestand
      var szenarioData = state.rawData.filter(function(d) {
        return cAcc(d) != 'Bestand';
      });

      state.years = sszvis.fn.set(szenarioData, yAcc);



      state.groups = sszvis.fn.set(state.rawData, gAcc);


      config.leftCategory = state.groups[0];
      config.rightCategory = state.groups[1];


      actions.selectYear(state.years[0]);
    },

    selectBar: function(x, age) {
      var nearestAgeRange = Math.floor(age);
      var rows = lookupByApproximateAge(state.data, age);

      state.selectedAge = {
        age: nearestAgeRange,
        rows: rows
      };

      render(state);
    },

    deselectBar: function() {
      state.selectedAge = [];
      render(state);
    },
    selectYear: function(year) {

      state.selectedYear = year;
      state.data = state.rawData.filter(function(d) {
        return yAcc(d) == year || cAcc(d) == 'Bestand';
      });



      var grouper = sszvis.cascade()
        .objectBy(cAcc)
        .objectBy(gAcc)
        .sort(function(a, b) {
          // Sort the groups in order of ascending age
          return d3.ascending(aAcc(a), aAcc(b));
        });

      var groupedData = grouper.apply(state.data);



      state.populations = grouper.apply(state.data);

       

      // use the unique age listings as the basis for the ordinal y-scale
      state.ages = sszvis.fn.set(state.data, aAcc);

    

      state.ageExtent = d3.extent(state.data, aAcc);

      
      // get the maximum binned value, for configuring the horizontal scale
      state.maxValue = d3.max([d3.max(state.rawData, vAcc), 1.5]);


      render(state);
    },

    resize: function() { render(state); }
  };


  /* Data initialization
  ----------------------------------------------- */
  d3.csv(config.dataPath)
    .row(function(d) {

      return {
        age: sszvis.parse.number(d[config.ageColumn]),
        gender: d[config.genderColumn],
        value: sszvis.parse.number(d[config.valueColumn]),
        year: d[config.yearColumn],
        category: d[config.categoryColumn]
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
    var props = queryProps(sszvis.fn.measureDimensions(config.targetElement));
    var pyramidWidth = sszvis.fn.measureDimensions(config.targetElement).width - 2;
    var pyramidDimensions = sszvis.layout.populationPyramidLayout(pyramidWidth, state.ages.length);
    var chartPadding = { top: 100, bottom: 86 };
    var bounds = sszvis.bounds({ height: chartPadding.top + pyramidDimensions.totalHeight + chartPadding.bottom, top: chartPadding.top, bottom: chartPadding.bottom, left: pyramidDimensions.chartPadding, right: pyramidDimensions.chartPadding }, config.targetElement);


    // Scales
    var lengthScale = d3.scale.linear()
      .domain([0, state.maxValue])
      .range([0, bounds.innerWidth / 2]);

    var colorScale = genderScale.domain(state.groups);

    var positionScale = d3.scale.ordinal()
      .domain(state.ages)
      .range(pyramidDimensions.positions);

    var yAxisLabelScale = positionScale.copy()
      .range(pyramidDimensions.positions.map(function(d) {
        return d + pyramidDimensions.barHeight / 2
      }));

    // Layers
    var chartLayer = sszvis.createSvgLayer(config.targetElement, bounds, {
        title: (''),
        description: ('')
      })
      .datum(state.populations);

    var controlLayer = sszvis.createHtmlLayer(config.targetElement, bounds);

    var tooltipLayer = sszvis.createHtmlLayer(config.targetElement, bounds)
      .datum(state.selectedAge);

    // Components

    var pyramid = sszvis.component.pyramid()
      .barFill( /*sszvis.fn.compose(colorScale, gAcc)*/ function(d) {
        var c = colorScale(gAcc(d));
        return aAcc(d) === state.selectedAge.age ? sszvis.color.slightlyDarker(c) : c;
      })
      .barPosition(sszvis.fn.compose(positionScale, aAcc))
      .barHeight(pyramidDimensions.barHeight)
      .barWidth(sszvis.fn.compose(lengthScale, vAcc))
      .leftAccessor(sszvis.fn.compose(sszvis.fn.prop(config.leftCategory), szenAcc))
      .rightAccessor(sszvis.fn.compose(sszvis.fn.prop(config.rightCategory), szenAcc))
      .leftRefAccessor(sszvis.fn.compose(menAcc, bestAcc))
      .rightRefAccessor(sszvis.fn.compose(womenAcc, bestAcc))
      .tooltipAnchor(props.tooltipAnchor);

    var xAxis = sszvis.axis.x.pyramid()
      .scale(lengthScale)
      .orient('bottom')
      .title(config.xAxisLabel)
      .ticks(config.xTicks)
      .tickLength(config.fallback ? bounds.innerWidth : null)
      .titleAnchor('middle')
      .titleCenter(true)
      .alignOuterLabels(true);

    var yAxis = sszvis.axis.y.ordinal()
      .scale(yAxisLabelScale)
      .tickFormat(function(d) {
        return d === 0 ? null : d;
      })
      .orient('right')
      .title(config.yAxisLabel)
      .dyTitle(-18)
      .ticks(config.yTicks ? config.yTicks : 4);

    var colorLegend = sszvis.legend.ordinalColorScale()
      .scale(colorScale)
      .horizontalFloat(true);

    var tooltip = sszvis.annotation.tooltip()
      .renderInto(tooltipLayer)
      .header(function(d) {
        return aAcc(d) + '-jährige';
      })
      .body(function() {

        var rows = state.selectedAge.rows.map(function(r) {
          return [gAcc(r), sszvis.format.number(vAcc(r)) + " %"];
        });
        return rows;
      })
      .orientation(props.tooltipOrientation)
      .visible(function(d) {
        return state.selectedAge.age === aAcc(d) && gAcc(d) === config.rightCategory;
      });

    var buttonGroup = props.control()
      .values(state.years)
      .width(props.controlWidth)
      .current(state.selectedYear)
      .change(actions.selectYear);



    // Rendering

    chartLayer.selectGroup('populationPyramid')
      .datum(state.populations)
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth / 2, 0))
      .call(pyramid);

    chartLayer.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth / 2, bounds.innerHeight))
      .call(xAxis);

    chartLayer.selectGroup('yAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, 0))
      .call(yAxis);

    controlLayer.selectDiv('controls')
      .style('left', (bounds.innerWidth - buttonGroup.width()) / 2 + 'px')
      .style('top', (20 - bounds.padding.top) + 'px')
      .call(buttonGroup);

    chartLayer.selectAll('[data-tooltip-anchor]')
      .call(tooltip);

    chartLayer.selectGroup('colorLegend')
      .attr('transform', sszvis.svgUtils.translateString(0, bounds.innerHeight + config.legendPadding))
      .call(colorLegend);


    // Interaction
    if (!config.fallback) {
      var mouseXScale = d3.scale.linear().range([0, bounds.innerWidth]);
      var mouseYScale = d3.scale.linear().domain(state.ageExtent).range([bounds.innerHeight, 0]);
      var interactionLayer = sszvis.behavior.move()
        .xScale(mouseXScale)
        .cancelScrolling(isWithinBarContour(state.data, bounds.innerWidth/2, mouseXScale, lengthScale))
        .fireOnPanOnly(true)
        .yScale(mouseYScale)
        .on('move', actions.selectBar)
        .on('end', actions.deselectBar);

      chartLayer.selectGroup('interactionLayer')
        .call(interactionLayer);

      sszvis.viewport.on('resize', actions.resize);
    }

    //restyling, make reference line darker
    d3.selectAll('.sszvis-pyramid__referenceline')
      .style('stroke', '#555')
      .style('stroke-dasharray', '3 1');
  }

  function lookupByApproximateAge(data, approximageAge) {
    var nearestAgeRange = Math.floor(approximageAge);

    return data.filter(function(v) {
      return aAcc(v) === nearestAgeRange && cAcc(v) != 'Bestand';
    });
  }

  function isWithinBarContour(data, xCenter, xRelToPx, lengthScale) {
    return function(xRel, age) {
      var dataRow = lookupByApproximateAge(data, age);
      var x = xRelToPx(xRel);
      return sszvis.fn.every(function(d) {
        if (isLeft(d)) {
          return x >= xCenter - lengthScale(vAcc(d));
        } else {
          return x <= xCenter + lengthScale(vAcc(d));
        }
      }, dataRow);
    };
  }

  function groupAndStackAcc(d) {
    return gAcc(d) + ' (' + stackAcc(d) + ')';
  }

  function isLeft(d) {
    return cAcc(d) === 'weiblich';
  }

}(d3, sszvis, bev_pyramide_alter_anteilParams));
