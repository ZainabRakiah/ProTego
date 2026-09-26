import { Map, Mountain, Satellite, Moon } from "lucide-react";

/**
 * Base layers offered by the view switcher.
 *
 * All tile services below are 100% keyless, public open-source layers.
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
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, HERE, Garmin, Intermap",
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
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    invertInDark: true,
  },
];

export const DEFAULT_LAYER_ID = "street";

export function getLayer(id) {
  return MAP_LAYERS.find((l) => l.id === id) ?? MAP_LAYERS[0];
}

export function getActiveTileUrl(layer) {
  return layer.url;
}
