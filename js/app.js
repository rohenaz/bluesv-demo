const blueSvPrefix = "1DSXi8hvxn6Pd4TavhmTKxU7BUqS7cnxhw"

mapboxgl.accessToken = 'YOUR_MAPBOX_KEY';

// Turn the query into base64 encoded string.
let url = 'https://genesis.bitdb.network/q/1FnauZ9aUH2Bex6JzdcV4eNX7oLSSEbxtN/'

// Attach API KEY as header
let header = {
  // Replace with your API key
  headers: {
    key: 'YOUR_BITDB_KEY'
  }
}

var map = new mapboxgl.Map({
  container: 'map',
  zoom: 0.3,
  center: [0, 20],
  style: 'mapbox://styles/mapbox/dark-v10'
})

map.addControl(new mapboxgl.NavigationControl())

// filters for classifying aur quality into five categories based on severity
// ToDo - I don't know what good thresholds for this should be
var aqi1 = ["<", ["get", "aqi"], 40]

var aqi2 = ["all", [">=", ["get", "aqi"], 40],
  ["<", ["get", "aqi"], 60]
];
var aqi3 = ["all", [">=", ["get", "aqi"], 60],
  ["<", ["get", "aqi"], 80]
];
var aqi4 = ["all", [">=", ["get", "aqi"], 80],
  ["<", ["get", "aqi"], 100]
];
var aqi5 = [">=", ["get", "aqi"], 100]

// colors to use for the categories
var colors = ['#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c'];

map.on('load', function () {

  let data = {
    type: "FeatureCollection",
    crs: { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: []
  }

  queryAirQuality().then(aqi => {
    let final = []
    console.log('map this', aqi)
    let filtered = aqi.map(a => {
      let output = {}
      output.city = a.city[0]
      output.city_data = JSON.parse(a.city_data[0])
      output.time = a.time[0]

      // decompress out.b6
      try {
        // console.log('decoding', a.sensors[0])
        output.sensors = JSON.parse(pako.ungzip(atob(a.sensors[0]), { to: 'string' }))
        // console.log('got', output.sensors)
      } catch (e) {
        console.log('err', e)
      }      
      
      return output
    }).filter(o => { return o.sensors })

    console.log('filtered', filtered)
    for(let x=0; x < filtered.length; x++) {
      let output = filtered[0]
      console.log('got', output.sensors) // array of points
      let len = output.sensors ? output.sensors.length : 0
      while(len--) {
        let lat = output.sensors[len].la
        let lng = output.sensors[len].lo
        
        // Avoid pushing multiple records to same coordinates
        if (!final.some(a => { return a.geometry.coordinates.some(c => { return c[1] === lat && c[0] === lng }) })) {
          let d = {
            type: 'Feature',
            properties: {
              id: output.city,
              aqi: parseInt(output.city_data.aqi),
              time: output.time,
              co: output.sensors[len].co,
              no2: output.sensors[len].no2,
              o3: output.sensors[len].o3,
              pm10: output.sensors[len].pm10,
              pm25: output.sensors[len].pm25,
              pol: output.sensors[len].pol,
              so2: output.sensors[len].so2,
              sta: output.sensors[len].sta,
            },
            geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            }
          }

          final.push(d)
        }

      }
    }
    data.features = final
    console.log('gots it', data)

    map.addSource('air_quality', {
      "type": "geojson",
      "data": data, // for comparison: "https://docs.mapbox.com/mapbox-gl-js/assets/earthquakes.geojson"
      "cluster": true,
      "clusterRadius": 80,
      "clusterProperties": { // keep separate counts for each magnitude category in a cluster
        "aqi1": ["+", ["case", aqi1, 1, 0]],
        "aqi2": ["+", ["case", aqi2, 1, 0]],
        "aqi3": ["+", ["case", aqi3, 1, 0]],
        "aqi4": ["+", ["case", aqi4, 1, 0]],
        "aqi5": ["+", ["case", aqi5, 1, 0]]
      }
    })

    map.addLayer({
      "id": "air_quality_circle",
      "type": "circle",
      "source": "air_quality",
      "filter": ["!=", "cluster", true],
      "paint": {
        "circle-color": ["case",
          aqi1, colors[0],
          aqi2, colors[1],
          aqi3, colors[2],
          aqi4, colors[3], colors[4]
        ],
        "circle-opacity": 0.6,
        "circle-radius": 12
      }
    })

    map.addLayer({
      "id": "air_quality_label",
      "type": "symbol",
      "source": "air_quality",
      "filter": ["!=", "cluster", true],
      "layout": {
        "text-field": ["number-format", ["get", "aqi"], {
          "min-fraction-digits": 1,
          "max-fraction-digits": 1
        }],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": 10
      },
      "paint": {
        "text-color": ["case", ["<", ["get", "aqi"], 3], "black", "white"]
      }
    })
  })

  // objects for caching and keeping track of HTML marker objects (for performance)
  var markers = {}
  var markersOnScreen = {}
  
  async function queryAirQuality() {
    let query = {
      "v":3,
      "q":{
        "aggregate": [
          {
            "$match": {
              "$text": {
                "$search": blueSvPrefix
              },
              "out.s1": blueSvPrefix,
              "out.s6": {"$exists": true},
              "blk.i": { "$gt": 60550 } // Make sure we're only looking at newer data format
            }
          },{
            "$sort": { "blk.t" : -1 }
          },{
            "$group": {
              "_id": "$out.s3",
              "city": {"$first": "$out.s3"},
              "time": {"$first": "$out.s4"},
              "city_data": {"$first": "$out.s5"},
              "sensors": {"$first": "$out.b6"}
            }
          }
        ],
        "limit": 300
      }
    }


    // base 64 query
    let b64 = btoa(JSON.stringify(query))

    // Make an HTTP request to bmap endpoint
    try {
      let r = await fetch(url + b64, header)
      let json = await r.json()
      // // Confirmed and unconfirmed
      return json.c.concat(json.u)
    } catch (e) {
      console.log('error fetch air quality data', e)
    }
  }

  function updateMarkers() {
    var newMarkers = {};
    var features = map.querySourceFeatures('air_quality')

    // for every cluster on the screen, create an HTML marker for it (if we didn't yet),
    // and add it to the map if it's not there already
    for (var i = 0; i < features.length; i++) {
      var coords = features[i].geometry.coordinates;
      var props = features[i].properties;
      if (!props.cluster) continue;
      var id = props.cluster_id;

      var marker = markers[id];
      if (!marker) {
        var el = createDonutChart(props)
        marker = markers[id] = new mapboxgl.Marker({
          element: el
        }).setLngLat(coords)
      }
      newMarkers[id] = marker;

      if (!markersOnScreen[id])
        marker.addTo(map)
    }
    // for every marker we've added previously, remove those that are no longer visible
    for (id in markersOnScreen) {
      if (!newMarkers[id])
        markersOnScreen[id].remove()
    }
    markersOnScreen = newMarkers;
  }

  // after the GeoJSON data is loaded, update markers on the screen and do so on every map move/moveend
  map.on('data', function (e) {
    if (e.sourceId !== 'air_quality' || !e.isSourceLoaded) return;

    map.on('move', updateMarkers)
    map.on('moveend', updateMarkers)
    updateMarkers()
  })
})

// code for creating an SVG donut chart from feature properties
function createDonutChart(props) {
  var offsets = [];
  var counts = [props.aqi1, props.aqi2, props.aqi3, props.aqi4, props.aqi5];
  var total = 0;
  for (var i = 0; i < counts.length; i++) {
    offsets.push(total)
    total += counts[i];
  }
  var fontSize = total >= 1000 ? 22 : total >= 100 ? 20 : total >= 10 ? 18 : 16;
  var r = total >= 1000 ? 50 : total >= 100 ? 32 : total >= 10 ? 24 : 18;
  var r0 = Math.round(r * 0.6)
  var w = r * 2;

  var html = '<svg width="' + w + '" height="' + w + '" viewbox="0 0 ' + w + ' ' + w +
    '" text-anchor="middle" style="font: ' + fontSize + 'px sans-serif">';

  for (i = 0; i < counts.length; i++) {
    html += donutSegment(offsets[i] / total, (offsets[i] + counts[i]) / total, r, r0, colors[i])
  }
  html += '<circle cx="' + r + '" cy="' + r + '" r="' + r0 +
    '" fill="white" /><text dominant-baseline="central" transform="translate(' +
    r + ', ' + r + ')">' + total.toLocaleString() + '</text></svg>';

  var el = document.createElement('div')
  el.innerHTML = html;
  return el.firstChild;
}

function donutSegment(start, end, r, r0, color) {
  if (end - start === 1) end -= 0.00001;
  var a0 = 2 * Math.PI * (start - 0.25)
  var a1 = 2 * Math.PI * (end - 0.25)
  var x0 = Math.cos(a0),
    y0 = Math.sin(a0)
  var x1 = Math.cos(a1),
    y1 = Math.sin(a1)
  var largeArc = end - start > 0.5 ? 1 : 0;

  return ['<path d="M', r + r0 * x0, r + r0 * y0, 'L', r + r * x0, r + r * y0,
    'A', r, r, 0, largeArc, 1, r + r * x1, r + r * y1,
    'L', r + r0 * x1, r + r0 * y1, 'A',
    r0, r0, 0, largeArc, 0, r + r0 * x0, r + r0 * y0,
    '" fill="' + color + '" />'
  ].join(' ')
}