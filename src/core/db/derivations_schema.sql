-- Schema for user-defined Derivations (high-level recipes)
CREATE TABLE IF NOT EXISTS derivations (
    derivation_id TEXT PRIMARY KEY,      -- Stable, unique ID (e.g., UUID assigned on creation)
    recipe_params TEXT NOT NULL,         -- Stable JSON string of the *user's potentially nested* DerivationParams object
    label TEXT,                          -- Optional human-readable name
    final_step_id TEXT NOT NULL,                  -- FK to steps table, points to the last step in the execution graph for this derivation. Can be shared by multiple derivations.
    dsl_expression TEXT NOT NULL,        -- Original user-entered DSL expression
    created_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
    updated_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
    FOREIGN KEY (final_step_id) REFERENCES steps(step_id) ON DELETE SET NULL -- Or ON DELETE RESTRICT if a step tied to a derivation should not be deleted if the derivation exists.
                                                                            -- SET NULL allows the step to be deleted, orphaning the derivation's link, implying it needs replanning or is invalid.
);

-- Schema for atomic execution Steps (internal representation of operations)
CREATE TABLE IF NOT EXISTS steps (
    step_id TEXT PRIMARY KEY,            -- Stable, unique ID for this atomic step (e.g., UUID)
    operation_params TEXT NOT NULL, -- JSON string of parameters for this step
    created_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);

-- Schema for mapping a computed Step to its output content hash
-- The global cache of computed results, keyed by deterministic cache_key.
CREATE TABLE IF NOT EXISTS step_results (
    cache_key TEXT PRIMARY KEY,          -- sha256(operation_slice || '|' || joined_input_hashes)
    output_content_hash TEXT NOT NULL,   -- Hash of the output content (present in content_cache)
    resolved_pinned_input_hashes TEXT,   -- JSON string mapping pinned input paths to their content hashes at computation time. NULL if no pinned inputs.
    input_content_hashes TEXT NOT NULL,  -- JSON string of input content hashes at computation time.
    warnings TEXT,                       -- JSON string of OperationWarning[] produced during computation (nullable)
    computed_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
-- Index useful for GC or introspection: find results that produced a given output hash
CREATE INDEX IF NOT EXISTS idx_step_results_output ON step_results(output_content_hash);

-- Bridge table linking a step_id (from the user recipe graph) to the shared cache row.
CREATE TABLE IF NOT EXISTS step_result_links (
    step_id TEXT PRIMARY KEY,
    cache_key TEXT NOT NULL,
    dependency_tree TEXT,               -- JSON string of the dependency tree for quick cache hits
    FOREIGN KEY (step_id)   REFERENCES steps(step_id)          ON DELETE CASCADE,
    FOREIGN KEY (cache_key) REFERENCES step_results(cache_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_srl_cache_key ON step_result_links(cache_key);


-- Schema for linking Steps to the raw content hashes they depend on directly
-- (Formerly derivation_input_content)
CREATE TABLE IF NOT EXISTS step_input_content (
    step_id TEXT NOT NULL,               -- The step using the input
    input_content_hash TEXT NOT NULL,    -- The content hash being used
    PRIMARY KEY (step_id, input_content_hash),
    FOREIGN KEY (step_id) REFERENCES steps(step_id) ON DELETE CASCADE
);
-- Index needed for GC: Find all steps using a specific content hash
CREATE INDEX IF NOT EXISTS idx_sic_content_hash ON step_input_content(input_content_hash);


-- Schema for linking Steps to other Steps they depend on
-- (Formerly derivation_input_derivation)
CREATE TABLE IF NOT EXISTS step_input_step (
    consuming_step_id TEXT NOT NULL,     -- The step using the input from another step
    providing_step_id TEXT NOT NULL,     -- The step whose output is being used as input
    PRIMARY KEY (consuming_step_id, providing_step_id),
    FOREIGN KEY (consuming_step_id) REFERENCES steps(step_id) ON DELETE CASCADE,
    FOREIGN KEY (providing_step_id) REFERENCES steps(step_id) ON DELETE CASCADE
);
-- Index needed for GC/Dependency Traversal: Find all steps using a specific step as input
CREATE INDEX IF NOT EXISTS idx_sis_providing_id ON step_input_step(providing_step_id);
CREATE INDEX IF NOT EXISTS idx_sis_consuming_id ON step_input_step(consuming_step_id); -- Also useful

-- The derivation_final_steps table is removed as final_step_id is now a column in the derivations table. 