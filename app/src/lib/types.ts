export type Sort = 'recentes' | 'antigos' | 'aleatorio' | 'favoritos';

export interface ImageItem {
  uuid: string;
  thumb: string;
  display: string;
  width: number;
  height: number;
  favorite: boolean;
  ts: number;
  bytes: number;
  model: string | null;
}

export interface ImageList {
  items: ImageItem[];
  next: string | null;
  total: number;
  sort: Sort;
}

export interface TagFacet {
  id: number;
  en: string;
  pt: string;
  categoria: string;
  sub: string;
  curated: boolean;
  count: number;
}

export interface CategoryFacet {
  key: string;
  label: string;
  subs: Record<string, string>;
  count: number;
  tags: TagFacet[];
}

export interface Facets {
  categories: CategoryFacet[];
  models: { id: number; name: string; count: number }[];
  loras: { id: number; name: string; count: number }[];
  total: number;
}

export interface LoraInfo {
  name: string;
  short: string;
  model_strength: number | null;
  clip_strength: number | null;
}

export interface TagInfo {
  id: number;
  name_en: string;
  label_pt: string;
  categoria: string;
  subcategoria: string;
  curated: number;
}

export interface ImageDetail {
  uuid: string;
  folder: string;
  filename: string;
  urls: { orig: string; display: string; thumb: string };
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  prompt: string | null;
  negative_prompt: string | null;
  model: string | null;
  model_file: string | null;
  seed: number | null;
  steps: number | null;
  cfg: number | null;
  ts: number;
  created_at: string;
  favorite: boolean;
  view_count: number;
  deleted: boolean;
  loras: LoraInfo[];
  tags: TagInfo[];
  tags_by_category: Record<string, { id: number; en: string; pt: string; sub: string; curated: boolean }[]>;
  position: number | null;
  total: number;
  neighbors: { prev: string | null; next: string | null };
}

export interface Me {
  user: { id: number; username: string };
  csrf: string;
  settings: {
    site_name: string;
    page_limit: number;
    privacy_blur: boolean;
    sync_configured?: boolean;
  };
}

export interface Stats {
  images: number;
  trash: number;
  favorites: number;
  bytes: number;
  bytes_total: number;
  models: number;
  loras: number;
  tags: number;
  pending_local_deletions: number;
  last_upload: string | null;
  oldest: number | null;
  newest: number | null;
}

export interface TrashItem {
  uuid: string;
  thumb: string;
  deleted_at: string;
  model: string | null;
}

export interface AdminTag {
  id: number;
  en: string;
  pt: string;
  categoria: string;
  sub: string;
  curated: boolean;
  usage: number;
}

export interface UploadRow {
  id: number;
  image_id: number | null;
  uuid: string;
  ip: string;
  bytes: number;
  ms: number;
  action: string;
  created_at: string;
}

export interface Dictionary {
  categories: Record<string, { label: string; subs: Record<string, string> }>;
  tags: { id: number; en: string; pt: string; categoria: string; sub: string; usage: number }[];
}
