ALTER TABLE `language_models` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `language_model_providers` ADD `api_type` text DEFAULT 'openai' NOT NULL;