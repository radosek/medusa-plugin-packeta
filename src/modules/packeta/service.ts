import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import { PacketaClient } from "../../providers/packeta/lib/client"
import { PacketaFeed } from "../../providers/packeta/lib/feed"
import { validatePacketaOptions } from "../../providers/packeta/service"
import {
	resolveOptions,
	type PacketaOptions,
	type ResolvedPacketaOptions,
} from "../../providers/packeta/types"
import PacketaPacket from "./models/packeta-packet"

/**
 * Data service for packet records plus a shared Packeta client/feed for
 * workflows and API routes (which cannot reach into the fulfillment module's
 * provider instance).
 */
class PacketaModuleService extends MedusaService({ PacketaPacket }) {
	protected readonly options_: ResolvedPacketaOptions
	protected client_: PacketaClient | null = null
	protected feed_: PacketaFeed | null = null

	constructor(container: Record<string, unknown>, options?: PacketaOptions) {
		super(...arguments)
		if (!options?.api_password) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Packeta module requires the same options as the fulfillment provider (`api_password`, `api_key`, `eshop`). Register `medusa-plugin-packeta/modules/packeta` with those options in medusa-config.ts.",
			)
		}
		validatePacketaOptions(options)
		this.options_ = resolveOptions(options)
	}

	getOptions(): ResolvedPacketaOptions {
		return this.options_
	}

	getClient(): PacketaClient {
		return (this.client_ ??= new PacketaClient(this.options_))
	}

	getFeed(): PacketaFeed {
		return (this.feed_ ??= new PacketaFeed(this.options_))
	}
}

export default PacketaModuleService
