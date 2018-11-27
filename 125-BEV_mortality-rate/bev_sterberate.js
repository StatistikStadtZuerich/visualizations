(function(d3, sszvis, bev_sterberateParams) {
  'use strict';

  if (sszvis.fallback.unsupported()) {
    sszvis.fallback.render(config.targetElement);
    return;
  }

    /* Globals 
 ------------------------------------------------*/
 // CONFIG
 // some default values for the chart configuration
 // I tried to make these as few as possible. i.e. if


  /* Configuration
  ----------------------------------------------- */
  // CONFIG
  // if a variable is optional, the code needs to work with default values 
  // if variable is missing. 
  var queryProps = sszvis.responsiveProps();
  var config = {
    dataPath: bev_sterberateParams.data,
    title: bev_sterberateParams.title, //optional
    description: bev_sterberateParams.description, //optional
    dateColumn: 'Jahr',
    valueColumn: 'Wert',
    categoryColumn: 'Kategorie',
    yLabel1: '',
    xLabel: '', 
    ticks: 5,
    fallback: false, //optional, creates long ticks when true
    targetElement: bev_sterberateParams.id
  }


  /* Shortcuts
  ----------------------------------------------- */
  var xAcc = sszvis.fn.prop('date');
  var yAcc = sszvis.fn.prop('value');
  var cAcc = sszvis.fn.prop('region');

  // a few helpers to distinguish between data that belongs on axis1 (left) and axis2 (right)
  var axis2 = ['Anteil 60+']; // the values for "Region" that go in axis2
  var valueIsOnAxis2 = function(d) { return sszvis.fn.contains(axis2, d); };
  var datumIsOnAxis2 = sszvis.fn.compose(valueIsOnAxis2, cAcc);


  /* Application State
  ----------------------------------------------- */
  var state = {
    data: [],
    lineData: [],
    dates: [0, 0],
    selection: [],
    axis1maxY: 0,
    axis2maxY: 0,
    categories1: [],
    categories2: []
  };


  /* State transitions
  ----------------------------------------------- */
  var actions = {
    prepareState: function(data) {
      state.data = data;
      state.dates = d3.extent(state.data, xAcc);
      state.lineData = sszvis.cascade()
        .arrayBy(cAcc, d3.ascending)
        .apply(state.data);

      // Compute two different maximum y values - one for each axis.
      // Multiply axis1maxY by a small number to ensure that the data for
      // category 1 doesn't overlap with category 2 data
      state.axis1maxY = d3.max(state.data.filter(sszvis.fn.not(datumIsOnAxis2)), yAcc) * 1.2;
      state.axis2maxY = d3.max(state.data.filter(datumIsOnAxis2), yAcc);

      // Two different sets of categories for two color scales
      state.categories1 = sszvis.fn.set(state.data.filter(sszvis.fn.not(datumIsOnAxis2)), cAcc);
      state.categories2 = sszvis.fn.set(state.data.filter(datumIsOnAxis2), cAcc);

      render(state);
    },

    changeDate: function(inputDate) {
      var closestDate = xAcc(closestDatum(state.data, xAcc, inputDate));
      var closestData = state.lineData.map(function(linePoints) {
        return sszvis.fn.find(function(d) {
          return sszvis.fn.stringEqual(xAcc(d), closestDate);
        }, linePoints);
      });
      state.selection = closestData.filter(
        sszvis.fn.compose(sszvis.fn.not(isNaN), yAcc)
      );

      render(state);
    },

    resetDate: function() {
      state.selection = [];
      render(state);
    },

    resize: function() { render(state); }
  };


  /* Data initialization
  ----------------------------------------------- */
  d3.csv(bev_sterberateParams.data)
    .row(function(d) {
      return {
        date: sszvis.parse.date(d[config.dateColumn]),
        region: d[config.categoryColumn],
        value: sszvis.parse.number(d[config.valueColumn])
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
    var props = queryProps(bounds);


    // Scales

    var xScale = d3.time.scale()
      .domain(state.dates)
      .range([0, bounds.innerWidth]);

    var yScale1 = d3.scale.linear()
      .domain([0, 20])
      .range([bounds.innerHeight, 0]);

    var yScale2 = d3.scale.linear()
      .domain([0, 100])
      .range([bounds.innerHeight, 0]);

    var cScale1 = sszvis.color.qual6a();
    var cScale2 = sszvis.color.qual6b();


    // Layers

    var chartLayer = sszvis.createSvgLayer(config.targetElement, bounds, {
        title: "",
        description: ""
      })
      .datum(state.lineData);


    // Components

    var line = sszvis.component.line()
      .x(sszvis.fn.compose(xScale, xAcc))
      .y(function(d) {
        return !datumIsOnAxis2(d) ? yScale1(yAcc(d)) : yScale2(yAcc(d));
      })
      // Access the first data point of the line to decide on the stroke color
      .stroke(function(lineData) {
        var d = sszvis.fn.first(lineData);
        return datumIsOnAxis2(d) ? cScale2(cAcc(d)) : cScale1(cAcc(d));
      });

	// var rulerLabel = sszvis.svgUtils.modularText.svg()
	  // .bold(sszvis.fn.compose(sszvis.format.number, yAcc))
	  // .plain(" kg ")
	  // .plain(cAcc);
    var rulerLabel = sszvis.svgUtils.modularText.svg()
      .bold(function(d){
        return sszvis.format.number(d.value)
      })
      .plain(function(d){
        return d.region == "Anteil 60+" ? " % Anteil 60+" : " ‰ Sterberate"
      });

    var ruler = sszvis.annotation.ruler()
      .top(0)
      .bottom(bounds.innerHeight)
      .label(rulerLabel)
      .x(sszvis.fn.compose(xScale, xAcc))
      .y(function(d) {
        return !datumIsOnAxis2(d) ? yScale1(yAcc(d)) : yScale2(yAcc(d));
      })
      .flip(function(d) {
        return xScale(xAcc(d)) >= bounds.innerWidth / 2;
      })
      .color(function(d) {
        return datumIsOnAxis2(d) ? cScale2(cAcc(d)) : cScale1(cAcc(d));
      });

    var xTickValues = xScale
      .ticks(5)
      .concat(state.selection.map(xAcc));

    var xAxis = sszvis.axis.x.time()
      .scale(xScale)
      .orient('bottom')
      .tickValues(xTickValues)
      .alignOuterLabels(true)
      .highlightTick(isSelected)
      // .title('Quartal')
      .titleCenter(true)
      .titleAnchor('middle');

    var yAxis1 = sszvis.axis.y()
      .scale(yScale1)
      .orient('right')
      .contour(true)
      .title('Sterberate')
      .dyTitle(-20)
      .tickFormat(function(d){
        if(d===0){
          return null;
        }
        return d + ' ‰';

      });

    var yAxis2 = sszvis.axis.y()
      .scale(yScale2)
      .orient('left')
      .contour(true)
      .title('Anteil an der Bevölkerung')
      .dyTitle(-20)
      .tickFormat(function(d){
        if(d===0){
          return null;
        }
        return d + ' %';

      });


    var cLegend1 = sszvis.legend.ordinalColorScale()
      .scale(cScale1)
      .orientation('vertical');

    var cLegend2 = sszvis.legend.ordinalColorScale()
      .scale(cScale2)
      .orientation('vertical')
      .rightAlign(true);





    // Rendering

 

    chartLayer.selectGroup('line')
      .call(line);

    chartLayer.selectGroup('xAxis')
      .attr('transform', sszvis.svgUtils.translateString(0, bounds.innerHeight))
      .call(xAxis);

    chartLayer.selectGroup('yAxis1')
      .call(yAxis1);

    chartLayer.selectGroup('yAxis2')
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth, 0))
      .call(yAxis2);

    chartLayer.selectGroup('cScale1')
      .attr('transform', sszvis.svgUtils.translateString(1, bounds.innerHeight + 60))
      .call(cLegend1);

    chartLayer.selectGroup('cScale2')
      .attr('transform', sszvis.svgUtils.translateString(bounds.innerWidth, bounds.innerHeight + 60))
      .call(cLegend2);

    chartLayer.selectGroup('rulerLayer')
      .datum(state.selection)
      .call(separateTwoLabelsVerticalOverlap)
      .call(ruler);


    // Interaction

    var interactionLayer = sszvis.behavior.move()
      .xScale(xScale)
      .yScale(yScale1) // In this example, which scale you use for the y-dimension of the move component doesn't matter
      .on('move', actions.changeDate)
      .on('end', actions.resetDate);

    chartLayer.selectGroup('interaction')
      .call(interactionLayer);

    sszvis.viewport.on('resize', actions.resize);
  }


  /* Helper functions
  ----------------------------------------------- */

  function closestDatum(data, accessor, datum) {
    var i = d3.bisector(accessor).left(data, datum, 1);
    var d0 = data[i - 1];
    var d1 = data[i] || d0;
    return datum - accessor(d0) > accessor(d1) - datum ? d1 : d0;
  }

  function isSelected(d) {
    return sszvis.fn.contains(state.selection.map(xAcc).map(String), String(d));
  }


 /**
   * Remove vertical overlap between  labels
   *
   */
  function separateTwoLabelsVerticalOverlap(g) {
    var THRESHOLD = 4;
    var labelBounds = [];

    // Reset vertical shift
    g.selectAll('text').each(function(d) {
      d3.select(this).attr('y', '');
    });

   

    // Calculate bounds
    g.selectAll('.sszvis-ruler__label').each(function(d, i) {
      var bounds = this.getBoundingClientRect();
      labelBounds.push({
        category: cAcc(d),
       // startTop: bounds.top,
       // startBottom: bounds.bottom,
        top: bounds.top,
        bottom: bounds.bottom,
        dy: 0
      });
    });


    // Sort by vertical position (only supports labels of same height)
    labelBounds = labelBounds.sort(function(a, b) {
      return d3.ascending(a.top, b.top);
    });

   

    // Calculate overlap and correct position 
    for(var i=0; i<100; i++){
  
      for(var j=0; j<labelBounds.length; j++){
        for(var k=j+1; k<labelBounds.length; k++){
          if(j===k) continue;
           var firstLabel = labelBounds[j];
           var secondLabel = labelBounds[k];
           var overlap = firstLabel.bottom - secondLabel.top;
          if (overlap >= THRESHOLD) {
            firstLabel.bottom -= overlap/2;
            firstLabel.top -= overlap/2;
            firstLabel.dy -= overlap/2;
            secondLabel.bottom += overlap/2;
            secondLabel.top += overlap/2;
            secondLabel.dy += overlap/2;
          }

        }
      }
    }

    // Shift vertically to remove overlap
    g.selectAll('text').each(function(d) {
      var label = sszvis.fn.find(function(l){return l.category === cAcc(d)}, labelBounds);
      if (label) {
        d3.select(this)
          .attr('y', label.dy);

      }
    });
  }


}(d3, sszvis, bev_sterberateParams));