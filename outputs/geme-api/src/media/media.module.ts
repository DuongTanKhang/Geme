import { Module } from "@nestjs/common";
import { MediaAssetsService } from "./media-assets.service.js";
import { MediaStorageService } from "./media-storage.service.js";

@Module({ providers: [MediaAssetsService, MediaStorageService], exports: [MediaAssetsService] })
export class MediaModule {}
