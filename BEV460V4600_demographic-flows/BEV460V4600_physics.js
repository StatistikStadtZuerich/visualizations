/**
 *
 * object containing all the physics
 *
 */
function sszvis_physics(w, h, _callback) {

    'use strict';

    //some helpers to interact with box2d;
    var b2Vec2 = Box2D.Common.Math.b2Vec2;
    var b2AABB = Box2D.Collision.b2AABB;
    var b2BodyDef = Box2D.Dynamics.b2BodyDef;
    var b2Body = Box2D.Dynamics.b2Body;
    var b2FixtureDef = Box2D.Dynamics.b2FixtureDef;
    var b2Fixture = Box2D.Dynamics.b2Fixture;
    var b2World = Box2D.Dynamics.b2World;
    var b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape;
    var b2CircleShape = Box2D.Collision.Shapes.b2CircleShape;
    var b2DebugDraw = Box2D.Dynamics.b2DebugDraw;
    var b2BuoyancyController = Box2D.Dynamics.Controllers.b2BuoyancyController;
    var b2ContactListener = Box2D.Dynamics.b2ContactListener;



    var peoplePerBubble = 2000;
    var RADIUS = 3;

    var data = [];

    var dataByYear = [];


    var currentYear = 2001;
    var minYear;
    var maxYear;


    var world;

    // Pixel-to-Meter ratio
    var PTM_RATIO = 30.0;



    //anchors
    var bestandAnchor = null;
    var zuAnchors = [];
    var wegAnchors = [];
    var gebAnchors = [];
    var todAnchors = [];

    var labelAnchors = [];

    var midoffset = 10;

    //convenince to have all anchors in an array, to address them all if needed
    var allAnchors = [];
    var anchorsByKey = [];

    var width = w;
    var height = h;


    //the number of zuzugsanchors and wegzuganchors that are visibile
    var npreview = 3;


    //particles
    var particles = [];

    var drag = 1;

    //        var file = 'bevoelkerung.csv';
    var ready = false;
    var ERROR = false;

    //for smoothing animation
    var yearBuffer = [];
    //update every 60 frames (approx every second)
    var updateFreq = 7;
    var frameCounter = 0;
    var updateCallback = _callback;

    var framerate = 60;
    var distance = new b2Vec2(0, 0);





    function proc() {

    }

    proc.TYPE_BESTAND = 'bestand';
    proc.TYPE_ZUZUG = 'zuzug';
    proc.TYPE_WEGZUG = 'wegzug';
    proc.TYPE_GEBURT = 'geburt';
    proc.TYPE_TOD = 'tod';

    proc.getCurrentYear = function() {
        return currentYear;
    };

    proc.getParticles = function() {
        return particles;
    };

    proc.getAllAnchors = function() {
        return allAnchors;
    };

    proc.getLabelAnchors = function() {
        return labelAnchors;
    };

    proc.getPeoplePerBubble = function() {
        return peoplePerBubble;
    };

    proc.getBubbleRadius = function() {
        return RADIUS;
    };

    proc.getMidOffset = function() {
        return midoffset;
    };

    proc.getDataByYear = function() {
        return dataByYear;
    };

    proc.addParticles = function(_type, _year, _n) {
        var newparts = createParticles(world, _n, bestandAnchor.x, bestandAnchor.y, 5);
        tagParticles(newparts, _year, proc.TYPE_BESTAND);
        particles = particles.concat(newparts);
    };

    proc.removeParticles = function(_type, _year, _n) {
        var killCandidates = particles.filter(function(p) {
            return p.type == 'bestand' && p.year == _year;
        });
        var toBeKilled = killCandidates.slice(0, _n);
        console.assert(toBeKilled.length === _n, 'toBeKilled not right size expected  ' + _n + ' got:  ' + toBeKilled.length);
        particles = removeAll(particles, toBeKilled);
    };



    proc.update = function() {

        if (!ready) {
            console.log('proc.update not ready, returning');
            return;
        }
        if (ERROR) {
            console.log('ERROR,returning');
            return;
        }

        //check if we need to set a new year
        frameCounter--;

        //can we update year?
        if (frameCounter <= 0) {
            frameCounter = updateFreq;
            if (yearBuffer.length > 0) {
                var newYear = yearBuffer.shift();
                proc.setYear(newYear);
                updateCallback();
            }
        }

        // Update the world simulation
        world.Step(
            1 / framerate, //frame-rate
            20, //velocity iterations
            20 //position iterations
        );

        world.ClearForces();

        particles.forEach(function(p) {

            var anchor = anchorsByKey[p.getKey()];

            if (!anchor) {
                //TODO refactor
                if (p.year == bestandAnchor.year && p.type == proc.TYPE_ZUZUG) {
                    anchor = bestandAnchor;
                } else if (p.year == bestandAnchor.year && p.type == proc.TYPE_GEBURT) {
                    anchor = bestandAnchor;
                } else {
                    ERROR = true;
                }
            }
            applyAttraction(anchor, p);
            applyDrag(p);
        });
    };

    proc.setYear = function(yr) {
        //  console.log('proc.setYear yr',yr);
        ready = true;

        if (yr == currentYear) {
            ready = true;
            return;
        } else if (currentYear < yr) {
            while (currentYear < yr) {
                currentYear++;
                //console.log('updating system forward to', currentYear);
                updateSystemForward(currentYear);
            }
        } else if (currentYear > yr) {
            while (currentYear > yr) {
                currentYear--;
                updateSystemBackward(currentYear);
            }
        } else {
            console.log('something is wrong in setYear');
        }
        ready = true;
    };

    proc.setYear2 = function(yr) {
        ready = true;
        if (yearBuffer.length === 0) {
            yearBuffer.push(yr);
            return;
        }
        var lastYear = yearBuffer[yearBuffer.length - 1];
        var diff = yr - lastYear;
        var steps = Math.abs(diff);

        var sign = diff > 0 ? 1 : -1;
        for (var i = 0; i < steps; i++) {
            yearBuffer.push(lastYear + (i + 1) * sign);
        }
        ready = true;
    };

    proc.init = function(rows, _year) {

        var physicsData = transformLongToWide(rows);

        data = physicsData;

        //create dataByYear lookup
        dataByYear = buildDataByYear(data);

        //calculate number bubbles and save in data
        data = calcNumberOfBubbles(data);

        //get all the years in data
        var years = data.map(yearAcc);

        //year extents
        minYear = d3.min(years);
        maxYear = d3.max(years);

        initWorld(_year);

        ready = true;
    };

    function initWorld(yr) {

        //set current Year
        currentYear = yr;

        world = new b2World(
            new b2Vec2(0, 0), //gravity is zero in space
            true //allow sleep
        );

        //ANCHORS

        //bestand anchor
        bestandAnchor = createAnchor(world, width / 2 + midoffset, height / 2);
        bestandAnchor.setYear(currentYear);
        bestandAnchor.setType(proc.TYPE_BESTAND);

        //zuzug anchors
        //zuzuge are going to the future
        var off = 30;
        var upper = 0.5 * height - off; //height / 3 + 20;
        var lower = 0.5 * height + off; //2 * height / 3 - 20;

        zuAnchors = createInAnchors2(world, currentYear, npreview, proc.TYPE_ZUZUG, lower);

        //wegzugeAnchors
        wegAnchors = createOutAnchors2(world, currentYear, npreview, proc.TYPE_WEGZUG, lower);

        //geburten anchors
        gebAnchors = createInAnchors2(world, currentYear, npreview, proc.TYPE_GEBURT, upper);

        //todesfälle anchors
        todAnchors = createOutAnchors2(world, currentYear, npreview, proc.TYPE_TOD, upper);

        //create all anchors array
        allAnchors = concatAll(zuAnchors, [bestandAnchor], wegAnchors, gebAnchors, todAnchors);

        updateAnchorValues(allAnchors);

        var labeledWegAnchors = wegAnchors;
        labelAnchors = concatAll(zuAnchors, [bestandAnchor], labeledWegAnchors);

        anchorsByKey = buildAnchorsByKey(allAnchors);

        //correct anchors which are wegzu, tod and same year as bestand
        var correctAnchors = allAnchors.filter(function(a) {
            return a.year == bestandAnchor.year && (a.type == proc.TYPE_TOD || a.type == proc.TYPE_WEGZUG);
        });

        correctAnchors.forEach(function(a) {
            var corr = 20;
            corr = a.type == proc.TYPE_WEGZUG ? corr : -corr;

            var x = a.getX();
            var y = a.getY() + corr;
            a.setPos(x, y);

        });

        //PARTICLES
        //create Bestand particles

        var bubblesBestand = dataByYear[currentYear].bestNettoBubbles;
        var partsBestand = createParticles(world, bubblesBestand, bestandAnchor.x, bestandAnchor.y, 50);
        tagParticles(partsBestand, bestandAnchor.year, proc.TYPE_BESTAND);
        particles = particles.concat(partsBestand);

        //create zuzug particles which are already in best
        var bubblesCurrYearBestZu = dataByYear[currentYear].zuzBubbles;
        var bubblesCurrYearBestGeb = dataByYear[currentYear].gebBubbles;
        var scatter = 80;
        var bestZuParts = createParticles(world, bubblesCurrYearBestZu, bestandAnchor.x + scatter, bestandAnchor.y + scatter, 30);
        var bestGebParts = createParticles(world, bubblesCurrYearBestGeb, bestandAnchor.x + scatter, bestandAnchor.y - scatter, 30);

        tagParticles(bestZuParts, bestandAnchor.year, proc.TYPE_ZUZUG);
        tagParticles(bestGebParts, bestandAnchor.year, proc.TYPE_GEBURT);
        particles = particles.concat(bestZuParts);
        particles = particles.concat(bestGebParts);

        //zuzug particles
        var zuzparts = createParticlesFromAnchors(world, dataByYear, zuAnchors, 'zuzBubbles');
        particles = particles.concat(zuzparts);

        //wegzug particles
        var wegparts = createParticlesFromAnchors(world, dataByYear, wegAnchors, 'wegBubbles');
        particles = particles.concat(wegparts);

        //geburten particles
        var gebparts = createParticlesFromAnchors(world, dataByYear, gebAnchors, 'gebBubbles');
        particles = particles.concat(gebparts);

        //todesfälle particles
        var todparts = createParticlesFromAnchors(world, dataByYear, todAnchors, 'todBubbles');
        particles = particles.concat(todparts);

    }


    function transformLongToWide(rows) {
        var years = sszvis.fn.set(rows, function(r) {
            return yearAcc(r);
        });

        var _data = years.map(function(y) {

            var dataForYear = rows.filter(function(r) {
                return yearAcc(r) === y;
            });

            var _year = y;

            var _date = sszvis.parse.year('' + y);

            var _bestand = dataForYear.filter(function(d) {
                return cAcc(d) == 'Bevölkerung';
            });

            var _bestandNetto = dataForYear.filter(function(d) {
                return cAcc(d) == 'Basisbevölkerung';
            });

            var _value = _bestand;

            var _zuzug = dataForYear.filter(function(d) {
                return cAcc(d) == 'Zuzüge';
            });

            var _wegzug = dataForYear.filter(function(d) {
                return cAcc(d) == 'Wegzüge';
            });

            var _geburt = dataForYear.filter(function(d) {
                return cAcc(d) == 'Geburten';
            });

            var _tod = dataForYear.filter(function(d) {
                return cAcc(d) == 'Todesfälle';
            });

            return {
                year: _year,
                date: _date,
                bestand: _bestand[0].value,
                bestandNetto: _bestandNetto[0].value,
                value: _value[0].value,
                zuzug: _zuzug[0].value,
                wegzug: _wegzug[0].value,
                geburt: _geburt[0].value,
                tod: _tod[0].value
            };

        });

        return _data;
    }

    function cAcc(d) {
        return d.category;
    }

    function buildAnchorsByKey(anchors) {
        var hash = [];
        anchors.forEach(function(a) {
            var _key = a.getKey();
            hash[_key] = a;
        });

        return hash;
    }

    function concatAll() {

        var con = [];
        var args = Array.prototype.slice.call(arguments);
        args.forEach(function(arr) {
            con = con.concat(arr);
        });

        return con;
    }

    function tagParticles(arr, yr, type) {
        arr.forEach(function(p) {
            p.setYear(yr);
            p.setType(type);
        });

    }

    function buildDataByYear(_data) {
        var arr = [];

        _data.forEach(function(d) {
            arr[d.year] = d;
        });

        return arr;
    }

    function createParticlesFromAnchors(_world, _hash, anchors, _key) {
        var arr = [];
        anchors.forEach(function(a) {
            var _data = _hash[a.year];
            var n = _data[_key];
            var parts = createParticles(_world, n, a.x, a.y, 20);
            setParticleInfo(parts, a.year, a.type);
            arr = arr.concat(parts);
        });

        return arr;
    }

    function setParticleInfo(parts, yr, type) {
        parts.forEach(function(p) {
            p.setYear(yr);
            p.setType(type);
        });
    }


    function createInAnchors2(_world, _baseYear, _len, type, _y) {
        var anchors = [];

        var startYear = _baseYear;

        var mid = bestandAnchor.x;

        var gap = width / 6;
        var firstgap = width / 6;

        for (var i = 0; i < _len; i++) {
            var x = mid + firstgap + (i) * gap;
            var y = _y;
            var yr = startYear + i + 1;
            var a = createAnchor(_world, x, y);
            a.setYear(yr);
            a.setType(type);
            anchors.push(a);
        }

        return anchors;
    }

    function createOutAnchors2(_world, _baseYear, _len, type, _y) {
        var anchors = [];

        var startYear = _baseYear;

        var mid = bestandAnchor.x;

        var gap = width / 6;
        var firstgap = width / 12;
        var secondgap = width / 6;

        for (var i = 0; i < _len; i++) {

            var x = 0;
            if (i === 0) {
                x = mid - firstgap;
            } else if (i === 1) {
                x = mid - firstgap - secondgap;
            } else {
                x = mid - firstgap - secondgap - (i - 1) * gap;
            }
            var y = _y;
            var yr = startYear - i;

            var a = createAnchor(_world, x, y);
            a.setYear(yr);
            a.setType(type);
            anchors.push(a);
        }

        return anchors;
    }




    function createAnchor(_world, _x, _y) {

        var anchor = {
            x: _x,
            y: _y,
            radius: 0.1, //p2b(5);
            gravity: 50,
            body: null,
            type: '',
            year: -1
        };

        anchor.getKey = function() {
            return createKey(this.year, this.type);
        };

        anchor.setYear = function(y) {
            this.year = y;
        };

        anchor.setType = function(t) {
            this.type = t;
        };

        anchor.setPos = function(_x, _y) {
            this.x = _x;
            this.y = _y;

            var pos = new b2Vec2(p2b(_x), p2b(_y));
            anchor.body.SetPosition(pos);
        };

        anchor.setY = function(_y) {
            this.y = _y;
        };

        anchor.getX = function() {
            return this.x;
        };

        anchor.getY = function() {
            return this.y;
        };

        //init
        var fixDef = new b2FixtureDef();
        fixDef.density = 10.0;
        fixDef.friction = 10.0;
        fixDef.restitution = 0.0;

        var bodyDef = new b2BodyDef();
        bodyDef.type = b2Body.b2_staticBody;

        fixDef.shape = new b2CircleShape(p2b(anchor.radius));

        fixDef.isSensor = false;

        bodyDef.position.x = p2b(anchor.x);
        bodyDef.position.y = p2b(anchor.y);

        anchor.body = _world.CreateBody(bodyDef);
        anchor.body.CreateFixture(fixDef);

        return anchor;

    }

    function createKey(yr, tp) {
        return '' + yr + '-' + tp;
    }


    function calcNumberOfBubbles(_data) {

        var updated = _data.map(function(d) {
            d.zuzBubbles = Math.ceil(d.zuzug / peoplePerBubble);
            d.wegBubbles = Math.ceil(d.wegzug / peoplePerBubble);
            d.bestBubbles = Math.ceil(d.bestand / peoplePerBubble);
            d.bestNettoBubbles = Math.ceil(d.bestandNetto / peoplePerBubble);
            d.gebBubbles = Math.ceil(d.geburt / peoplePerBubble);
            d.todBubbles = Math.ceil(d.tod / peoplePerBubble);
            return d;
        });

        return updated;

    }

    function updateSystemBackward(yr) {

        //particle_weg_yr become particle_best_yr (assimilate)
        var assimWeg = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == proc.TYPE_WEGZUG;
        });
        var assimTod = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == proc.TYPE_TOD;
        });
        // console.log('assim.length',assim.length);
        assimilate(bestandAnchor, assimWeg);
        assimilate(bestandAnchor, assimTod);

        //update years
        //assign new year to each anchor
        var bestandParts = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == bestandAnchor.type;
        });
        updateAnchorYears2(yr, bestandAnchor, zuAnchors, wegAnchors, gebAnchors, todAnchors);
        updateAnchorValues(allAnchors);
        assimilate(bestandAnchor, bestandParts);

        //remove particles for the first anchor
        var displayedYears = allAnchors.map(yearAcc);

        var killCandidates = getKillCandidates(particles, displayedYears);

        particles = removeAll(particles, killCandidates);


        //create particles for last Anchor
        var lastWegAnchor = wegAnchors[wegAnchors.length - 1];
        var lastTodAnchor = todAnchors[todAnchors.length - 1];


        var data = dataByYear[lastWegAnchor.year];
        var nweg = data ? data.wegBubbles : 0;
        var ntod = data ? data.todBubbles : 0;

        var newpartsWeg = createParticles(world, nweg, lastWegAnchor.x - 100, lastWegAnchor.y, 30);
        var newpartsTod = createParticles(world, ntod, lastTodAnchor.x - 100, lastTodAnchor.y, 30);

        assimilate(lastWegAnchor, newpartsWeg);
        assimilate(lastTodAnchor, newpartsTod);
        particles = particles.concat(newpartsWeg);
        particles = particles.concat(newpartsTod);


        //chose particles from bestand to become zuzug_currYear
        var data = dataByYear[bestandAnchor.year];
        var nzuz = data.zuzBubbles;
        var ngeb = data.gebBubbles;

        //get the bestand particles
        ////sort by x position
        bestandParts.sort(function(a, b) {
            var posa = a.getPos();
            var posb = b.getPos();
            return posb.x - posa.x;
        });

        //get the n mostright particles
        var selectionZuz = bestandParts.slice(0, nzuz);
        var selectionGeb = bestandParts.slice(nzuz, nzuz + ngeb);

        selectionZuz.forEach(function(p) {
            p.setYear(bestandAnchor.year);
            p.setType(proc.TYPE_ZUZUG);
        });
        selectionGeb.forEach(function(p) {
            p.setYear(bestandAnchor.year);
            p.setType(proc.TYPE_GEBURT);
        });

        //update anchorsByKey
        anchorsByKey = buildAnchorsByKey(allAnchors);

    }

    function updateSystemForward(yr) {
        //particle_zu_yr become particle_best_yr (assimilate)
        var assimZuzug = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == proc.TYPE_ZUZUG;
        });
        var assimGeburt = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == proc.TYPE_GEBURT;
        });
        // console.log('assim.length',assim.length);
        assimilate(bestandAnchor, assimZuzug);
        assimilate(bestandAnchor, assimGeburt);

        //update years
        //assign new year to each anchor
        var bestandParts = particles.filter(function(p) {
            return p.year == bestandAnchor.year && p.type == bestandAnchor.type;
        });
        updateAnchorYears2(yr, bestandAnchor, zuAnchors, wegAnchors, gebAnchors, todAnchors);
        updateAnchorValues(allAnchors);
        assimilate(bestandAnchor, bestandParts);

        //remove particles for the last anchor
        var displayedYears = allAnchors.map(yearAcc);

        var killCandidates = getKillCandidates(particles, displayedYears);


        particles = removeAll(particles, killCandidates);

        //create particles for first Zuzug Anchor
        var firstZuzugAnchor = zuAnchors[zuAnchors.length - 1];
        var data = dataByYear[firstZuzugAnchor.year];
        var n = data ? data.zuzBubbles : 0;
        var newparts = createParticles(world, n, firstZuzugAnchor.x + 100, firstZuzugAnchor.y, 30);
        assimilate(firstZuzugAnchor, newparts);

        particles = particles.concat(newparts);

        //create particles for first Geburten Anchor
        var firstGeburtAnchor = gebAnchors[gebAnchors.length - 1];
        var data = dataByYear[firstGeburtAnchor.year];
        var n = data ? data.gebBubbles : 0;
        var newparts = createParticles(world, n, firstGeburtAnchor.x + 100, firstGeburtAnchor.y, 30);
        assimilate(firstGeburtAnchor, newparts);

        particles = particles.concat(newparts);

        //chose particles from bestand to become wegzug_currYear
        var firstWegAnchor = wegAnchors[0];
        var firstTodAnchor = todAnchors[0];
        var data = dataByYear[firstWegAnchor.year];
        var nweg = data.wegBubbles;
        var ntod = data.todBubbles;

        //get the bestand particles

        ////sort by x position
        bestandParts.sort(function(a, b) {
            var posa = a.getPos();
            var posb = b.getPos();
            return posa.x - posb.x;
        });

        //get the n mostright particles
        var selectionWeg = bestandParts.slice(0, nweg);
        var selectionTod = bestandParts.slice(nweg, nweg + ntod);

        assimilate(firstWegAnchor, selectionWeg);
        assimilate(firstTodAnchor, selectionTod);

        //update anchorsByKey
        anchorsByKey = buildAnchorsByKey(allAnchors);
    }

    function removeAll(parts, candidates) {

        var saved = parts.filter(function(p) {
            //return !(candidates.indexOf(p) >= 0);
            return candidates.indexOf(p) < 0;
        });
        killAll(candidates);
        return saved;
    }

    function killAll(arr) {

        arr.forEach(function(p) {
            p.kill();
        });

    }

    function getKillCandidates(parts, years) {

        var arr = parts.filter(function(p) {
            // return !(years.indexOf(p.year) >= 0)
            return years.indexOf(p.year) < 0;
        });

        return arr;

    }


    function updateAnchorYears2(yr, bes, zuArr, wegArr, gebArr, todArr) {

        //TODO make this more generic
        bes.setYear(yr);

        zuArr.forEach(function(a, i) {
            a.setYear(yr + i + 1);
        });
        gebArr.forEach(function(a, i) {
            a.setYear(yr + i + 1);
        });

        wegArr.forEach(function(a, i) {
            a.setYear(yr - i);
        });
        todArr.forEach(function(a, i) {
            a.setYear(yr - i);
        });
    }

    function updateAnchorValues(_anchors) {

        _anchors.forEach(function(a) {
            var yr = a.year;

            var data = dataByYear[yr];
            a.value = data ? data[a.type] : -1;
        });
    }




    function assimilate(anchor, parts) {
        parts.forEach(function(p) {
            p.setYear(anchor.year);
            p.setType(anchor.type);
        });
    }

    function applyDrag(p) {
        var v = p.getVel();

        var f = new b2Vec2(0, 0);
        f.Add(v);
        f.Multiply(-drag);

        p.body.ApplyForce(f, p.body.GetWorldCenter());

    }

    function applyAttraction(anchor, p) {
        applyAttraction3(anchor.body, p.body, anchor.gravity);
    }

    function applyAttraction3(anchor, p, gravity) {

        //hardcoded version, makes things faster
        var p_pos = p.GetWorldCenter();
        var anchor_pos = anchor.GetWorldCenter();

        distance.Set(0, 0);

        // Add the distance to the debris
        distance.Add(p_pos);

        // Subtract the distance to the anchors's position
        // to get the vector between the particle and the anchors.
        distance.Subtract(anchor_pos);

        if (distance.Length() < 0.01) {
            // console.log('setting gravity to zero');
            //gravity = 0;
            return;
        }
        var force = 5 / distance.Length() * distance.Length() * distance.Length();

        distance.Normalize();
        distance.NegativeSelf();

        distance.Multiply(force);
        p.ApplyForce(distance,
            p.GetWorldCenter());
    }



    function createParticles(_world, n, x, y, _offset) {

        var arr = [];
        var r = RADIUS;
        var offset = _offset ? _offset : 40;
        for (var i = 0; i < n; i++) {
            var _x = x + random(-offset, offset);
            var _y = y + random(-2 * offset, 2 * offset);
            var p = createParticle(_world, _x, _y, r, b2Body.b2_dynamicBody);
            arr.push(p);
        }

        return arr;

    }



    function createParticle(_world, x, y, r, type) {

        // Create the fixture definition
        var fixDef = new b2FixtureDef();

        fixDef.density = 10; // Set the density
        fixDef.friction = 1; // Set the friction
        fixDef.restitution = 0; // Set the restitution - bounciness

        // Define the shape of the fixture
        fixDef.shape = new b2CircleShape(p2b(r));

        // Create the body definition
        var bodyDef = new b2BodyDef();
        bodyDef.type = type;

        // Set the position of the body
        bodyDef.position.x = p2b(x);
        bodyDef.position.y = p2b(y);
        bodyDef.linearDamping = 0.0;
        bodyDef.angularDamping = 0.01;


        // Create the body in the box2d world
        var b = _world.CreateBody(bodyDef);
        b.CreateFixture(fixDef);

        var p = {
            radius: r,
            year: -1,
            type: '',
            body: b,
            world: _world
        };

        p.setYear = function(y) {
            this.year = y;
        };

        p.setType = function(t) {
            this.type = t;
        };

        p.setPos = function(_x, _y) {

            var pos = new b2Vec2(p2b(_x), p2b(_y));
            //    console.log('this.body', this.body, 'pos', pos);
            this.body.SetPosition(pos);
        };

        p.getPos = function() {
            var pos = this.body.GetPosition();
            return new b2Vec2(b2p(pos.x), b2p(pos.y));
        };

        p.getVel = function() {
            return this.body.GetLinearVelocity();
        };

        p.getKey = function() {
            return createKey(this.year, this.type);
        };

        p.kill = function() {
            this.world.DestroyBody(this.body);
        };



        return p;
    }

    function yearAcc(a) {
        return a.year;
    }

    //convenience random function
    function random(min, max) {

        var rand;

        rand = Math.random();

        if (arguments.length === 0) {
            return rand;
        } else
        if (arguments.length === 1) {
            return rand * min;
        } else {
            if (min > max) {
                var tmp = min;
                min = max;
                max = tmp;
            }

            return rand * (max - min) + min;
        }
    }

    /*
     * p2b
     * Helper function to convert pixels to
     * Box2D metrics.
     */
    function p2b(pixels) {
        return pixels / PTM_RATIO;
    }

    function b2p(meters) {
        return meters * PTM_RATIO;
    }

    return proc;

}
