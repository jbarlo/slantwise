-- Schema for the core document registry
CREATE TABLE IF NOT EXISTS documents (
    doc_id TEXT PRIMARY KEY,          -- Unique identifier (UUID) for a tracked document instance
    content_hash TEXT NOT NULL          -- The SHA-256 hash of the content associated with this doc_id
);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents (content_hash);

-- Schema for mapping document instances to file paths
CREATE TABLE IF NOT EXISTS document_paths (
    path_id INTEGER PRIMARY KEY AUTOINCREMENT, -- Unique identifier for a path mapping
    doc_id TEXT NOT NULL,                   -- Foreign key to the documents table
    absolute_path TEXT NOT NULL,            -- Store the full, resolved path
    FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE, -- If a document is deleted, remove its paths
    UNIQUE (doc_id, absolute_path)          -- Prevent duplicate doc_id/path pairs
);
CREATE INDEX IF NOT EXISTS idx_document_paths_doc_id ON document_paths(doc_id);
-- Add index on path for faster cleanup lookups
CREATE INDEX IF NOT EXISTS idx_document_paths_path ON document_paths(absolute_path);

-- Schema for caching file content keyed by hash (append-only log for FTS)
CREATE TABLE IF NOT EXISTS content_cache (
    content_hash TEXT PRIMARY KEY, -- The SHA-256 hash of the content in this row
    content TEXT NOT NULL          -- The actual file content OR derived content
);

-- Schema for the hash-to-embedding cache
CREATE TABLE IF NOT EXISTS hash_embeddings (
    content_hash TEXT PRIMARY KEY, -- The SHA-256 hash (links to documents and content_cache)
    embedding TEXT NOT NULL,       -- Placeholder for the actual embedding data (e.g., JSON array, blob)
    model_name TEXT NOT NULL       -- Name/ID of the model that generated this embedding
    -- Optional FK: FOREIGN KEY (content_hash) REFERENCES content_cache(content_hash) -- Add if strict integrity needed
);

-- Schema for logging embedding generation usage
CREATE TABLE IF NOT EXISTS embedding_usage_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
    content_hash TEXT NOT NULL,    -- Hash of the content that was embedded
    model_name TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL
    -- Removed: document_path (can be found via content_hash -> documents -> document_paths if needed)
    -- Optional FK: FOREIGN KEY (content_hash) REFERENCES content_cache(content_hash) -- Add if strict integrity needed
);

-- Optional: Index on usage log hash
-- CREATE INDEX IF NOT EXISTS idx_embedding_usage_log_hash ON embedding_usage_log (content_hash);
