import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260817164712 extends Migration {
	override async up(): Promise<void> {
		this.addSql(
			`alter table if exists "packeta_packet" drop constraint if exists "packeta_packet_packet_id_unique";`,
		)
		this.addSql(
			`create table if not exists "packeta_packet" ("id" text not null, "packet_id" text not null, "barcode" text not null, "kind" text check ("kind" in ('pickup', 'hd', 'return')) not null, "fulfillment_id" text null, "order_id" text null, "number" text null, "status_id" integer null, "status_code" text null, "status_text" text null, "status_at" timestamptz null, "external_tracking_code" text null, "external_status_text" text null, "is_returning" boolean not null default false, "stored_until" text null, "cod" numeric not null default 0, "currency" text null, "value" numeric not null default 0, "weight_kg" real null, "carrier_id" text null, "point" jsonb null, "address" jsonb null, "tracking_url" text null, "password" text null, "last_event_id" text null, "shipped_marked_at" timestamptz null, "delivered_marked_at" timestamptz null, "cancelled_at" timestamptz null, "raw" jsonb null, "raw_cod" jsonb not null default '{"value":"0","precision":20}', "raw_value" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "packeta_packet_pkey" primary key ("id"));`,
		)
		this.addSql(
			`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_packeta_packet_packet_id_unique" ON "packeta_packet" ("packet_id") WHERE deleted_at IS NULL;`,
		)
		this.addSql(
			`CREATE INDEX IF NOT EXISTS "IDX_packeta_packet_deleted_at" ON "packeta_packet" ("deleted_at") WHERE deleted_at IS NULL;`,
		)
		this.addSql(
			`CREATE INDEX IF NOT EXISTS "IDX_packeta_packet_fulfillment_id" ON "packeta_packet" ("fulfillment_id") WHERE deleted_at IS NULL;`,
		)
		this.addSql(
			`CREATE INDEX IF NOT EXISTS "IDX_packeta_packet_order_id" ON "packeta_packet" ("order_id") WHERE deleted_at IS NULL;`,
		)
		this.addSql(
			`CREATE INDEX IF NOT EXISTS "IDX_packeta_packet_status_id" ON "packeta_packet" ("status_id") WHERE deleted_at IS NULL;`,
		)
	}

	override async down(): Promise<void> {
		this.addSql(`drop table if exists "packeta_packet" cascade;`)
	}
}
