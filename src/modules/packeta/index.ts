import { Module } from "@medusajs/framework/utils"
import PacketaModuleService from "./service"

export const PACKETA_MODULE = "packeta"

export default Module(PACKETA_MODULE, {
	service: PacketaModuleService,
})

export { PacketaModuleService }
