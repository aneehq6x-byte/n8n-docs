CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_profile_id" uuid NOT NULL,
	"type" text NOT NULL,
	"issuer" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certifications_profile_type_unique" UNIQUE("company_profile_id","type")
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"legal_name_ar" text NOT NULL,
	"legal_name_en" text NOT NULL,
	"sectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"annual_turnover" double precision NOT NULL,
	"max_contract_value" double precision NOT NULL,
	"past_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profiles_org_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" text NOT NULL,
	"region_ar" text,
	"region_en" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_org_name_unique" UNIQUE("org_id","name_en")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"company_profile_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"disqualified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_pair_unique" UNIQUE("tender_id","company_profile_id")
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"description_ar" text NOT NULL,
	"description_en" text NOT NULL,
	"sector" text NOT NULL,
	"value_estimate" double precision,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"required_classification_field" text,
	"required_classification_grade" integer,
	"required_certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guarantee" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"submission_deadline" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"raw_document_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenders_source_ref_unique" UNIQUE("org_id","source","source_ref")
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifications_profile_idx" ON "certifications" USING btree ("company_profile_id");--> statement-breakpoint
CREATE INDEX "opportunities_org_score_idx" ON "opportunities" USING btree ("org_id","score");--> statement-breakpoint
CREATE INDEX "opportunities_org_status_idx" ON "opportunities" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tenders_org_deadline_idx" ON "tenders" USING btree ("org_id","submission_deadline");--> statement-breakpoint
CREATE INDEX "tenders_org_sector_idx" ON "tenders" USING btree ("org_id","sector");