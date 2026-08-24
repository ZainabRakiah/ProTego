import { Map, Mountain, Satellite, Moon } from "lucide-react";

/**
 * Base layers offered by the view switcher.
 *
 * All four are key-free tile services. `invertInDark` marks the light-styled
 * rasters that get the night filter from index.css — satellite and dark-matter
 * must never be inverted or they turn into negatives.
 */
export const MAP_LAYERS = [
  {
    id: "street",
    label: "Street",
    description: "Standard road map",
    icon: Map,
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    invertInDark: true,
  },
  {
    id: "geographic",
    label: "Geographic",
    description: "Terrain, contours and elevation",
    icon: Mountain,
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
      '<a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
    invertInDark: true,
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "Aerial imagery",
    icon: Satellite,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    invertInDark: false,
  },
  {
    id: "night",
    label: "Night",
    description: "Low-glare dark basemap",
    icon: Moon,
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    invertInDark: false,
  },
];

export const DEFAULT_LAYER_ID = "street";

export function getLayer(id) {
  return MAP_LAYERS.find((l) => l.id === id) ?? MAP_LAYERS[0];
}
