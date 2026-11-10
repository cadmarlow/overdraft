[out:json][timeout:120];
(
  way["highway"~"^(footway|path|pedestrian|steps|bridleway)$"](40.763,-73.983,40.801,-73.948);
);
out geom;
