-- Galeria Anima -- schema MariaDB/MySQL 8 (utf8mb4)
-- Executar via: php app/cli/migrate.php

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  totp_secret   VARCHAR(64)  NULL,
  failed_count  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until  DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id         CHAR(64) NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  csrf       CHAR(64) NOT NULL,
  ip         VARCHAR(45) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_exp (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS models (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(150) NOT NULL,
  usage_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_models_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loras (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(150) NOT NULL,
  usage_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loras_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS images (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36) NOT NULL,
  folder          VARCHAR(80) NOT NULL,
  filename        VARCHAR(160) NOT NULL,
  sha256          CHAR(64) NOT NULL,
  bytes           INT UNSIGNED NOT NULL DEFAULT 0,
  width           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  height          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  path_orig       VARCHAR(120) NOT NULL DEFAULT '',
  path_disp       VARCHAR(120) NOT NULL DEFAULT '',
  path_thumb      VARCHAR(120) NOT NULL DEFAULT '',
  prompt          MEDIUMTEXT NULL,
  negative_prompt MEDIUMTEXT NULL,
  prompt_hash     CHAR(40) NOT NULL DEFAULT '',
  model_id        INT UNSIGNED NULL,
  seed            BIGINT NULL,
  steps           SMALLINT UNSIGNED NULL,
  cfg             DECIMAL(5,2) NULL,
  params_json     LONGTEXT NULL,
  ts_ms           BIGINT NOT NULL DEFAULT 0,
  favorite        TINYINT NOT NULL DEFAULT 0,
  view_count      INT UNSIGNED NOT NULL DEFAULT 0,
  deleted_at      DATETIME NULL,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_images_uuid (uuid),
  UNIQUE KEY uq_images_sha (sha256),
  KEY ix_images_ts (ts_ms DESC, id DESC),
  KEY ix_images_deleted (deleted_at, ts_ms),
  KEY ix_images_model (model_id),
  KEY ix_images_prompt_hash (prompt_hash),
  FULLTEXT KEY ft_images_prompt (prompt),
  CONSTRAINT fk_images_model FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_loras (
  image_id       BIGINT UNSIGNED NOT NULL,
  lora_id        INT UNSIGNED NOT NULL,
  strength_model DECIMAL(4,2) NULL,
  strength_clip  DECIMAL(4,2) NULL,
  pos            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (image_id, lora_id),
  KEY ix_image_loras_lora (lora_id),
  CONSTRAINT fk_il_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE,
  CONSTRAINT fk_il_lora  FOREIGN KEY (lora_id)  REFERENCES loras (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tags (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name_en     VARCHAR(120) NOT NULL,
  label_pt    VARCHAR(120) NOT NULL DEFAULT '',
  categoria   ENUM('cabelo','olhos','rosto','expressao','pose','corpo','roupa','acessorios','cenario','iluminacao','estilo','hora','outros') NOT NULL DEFAULT 'outros',
  subcategoria VARCHAR(24) NOT NULL DEFAULT '',
  curated     TINYINT NOT NULL DEFAULT 0,
  usage_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_name (name_en),
  KEY ix_tags_cat (categoria, usage_count DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_tags (
  image_id BIGINT UNSIGNED NOT NULL,
  tag_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (image_id, tag_id),
  KEY ix_image_tags_tag (tag_id, image_id),
  CONSTRAINT fk_it_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE,
  CONSTRAINT fk_it_tag   FOREIGN KEY (tag_id)   REFERENCES tags (id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS local_deletions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  image_id     BIGINT UNSIGNED NULL,
  uuid         CHAR(36) NOT NULL,
  folder       VARCHAR(80) NOT NULL,
  requested_at DATETIME NOT NULL,
  acked_at     DATETIME NULL,
  status       ENUM('pending','acked','failed') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  KEY ix_local_del_status (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS upload_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  image_id   BIGINT UNSIGNED NULL,
  uuid       CHAR(36) NOT NULL DEFAULT '',
  ip         VARCHAR(45) NOT NULL DEFAULT '',
  bytes      INT UNSIGNED NOT NULL DEFAULT 0,
  ms         INT UNSIGNED NOT NULL DEFAULT 0,
  action     VARCHAR(24) NOT NULL DEFAULT 'upload',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_upload_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  ip         VARCHAR(45) NOT NULL,
  username   VARCHAR(64) NOT NULL DEFAULT '',
  attempts   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  first_at   DATETIME NOT NULL,
  last_at    DATETIME NOT NULL,
  PRIMARY KEY (ip, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(64) NOT NULL,
  v TEXT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (k, v) VALUES
  ('site_name', 'Galeria Anima'),
  ('page_limit', '48'),
  ('privacy_blur', '0'),
  ('sync_token_hash', '')
ON DUPLICATE KEY UPDATE v = VALUES(v);
