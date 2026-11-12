---
title: geocode.fyi
date: 2026-09
status: released
category: tool
tags:
  - web
url: https://geocode.fyi
links:
  source: https://github.com/arfct/geocode
media:
  - src: geocode.png
    caption: The geocode tool with the Golden Gate Bridge found, its coordinates in three forms and a marker on the darkened map
    alt: A black page with a round dark grey map of San Francisco Bay at its center, a white ringed dot on the bridge, and at the top left small monospaced text listing a place name and three lines of coordinates
  - src: coordinates.png
    caption: The coordinate converter, with one pair written out as decimal degrees, as degrees, minutes and seconds, as degrees and decimal minutes, and as a GeoJSON position
    alt: A black page headed Coordinate converter, with a text field holding 37.7749, -122.4194, four example coordinates beneath it, and a table of four rows giving the same position in four notations
credits:
  - liquidx
unconfirmed: [date, credits, status]
---

Hemisphere letters count for more than order on geocode.fyi, so a coordinate pair typed as "122W, 37N" is read as the same place as "37N, 122W". The site reads a latitude and longitude in decimal degrees, in degrees, minutes and seconds, or in degrees and decimal minutes, and a separate page converts a pair between the three.

On the main page the map is a disc in the middle of a black screen, with three tools and a link to the converter listed at the top left. The map is OpenStreetMap with its tiles inverted to a dark grey, and everything the tools draw on it is off-white. Geocode looks up a place name, lists up to five matches and offers the chosen one's coordinates in three forms that differ only in the separator. Export turns one coordinate pair, with a name if wanted, into a GeoJSON, GPX or KML file. Preview draws a file of any of those three kinds, dropped on the page, onto the map; a DXF drawing replaces the map with a 3D view that can be turned and zoomed, in which lines, arcs and meshes are drawn and solids, hatches, text and dimensions are left out.

Place lookups go through the site's server to the Google Places API, so that the API key never reaches the browser. Parsing, conversion and export run in the browser.

SvelteKit, Leaflet, Three.js, Cloudflare Workers. 2026.
