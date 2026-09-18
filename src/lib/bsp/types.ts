// Shared types for the BSP module. target_behaviours/triggers/setting_events
// on a bsp row are COPIES of the same shape fba_reports.content_data
// already uses for those keys -- reused directly rather than redefined,
// so the two never drift apart.

import type { TargetBehaviourEntry, TriggerEntry, SettingEventEntry } from "@/lib/fba/types";

export type { TargetBehaviourEntry, TriggerEntry, SettingEventEntry };

export type BspStatus = "draft" | "active" | "superseded";
export type StrategyPlacement = "home" | "school" | "shared";

export interface BspRecord {
  id: string;
  passportId: string;
  institutionId: string | null;
  clinicianId: string;
  sourceFbaId: string | null;
  status: BspStatus;
  targetBehaviours: TargetBehaviourEntry[];
  triggers: TriggerEntry[];
  settingEvents: SettingEventEntry[];
  precursors: string | null;
  currentFrequency: string | null;
  signedAt: string | null;
  signedBy: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BspStrategy {
  id: string;
  bspId: string;
  sourceBankStrategyId: string | null;
  title: string;
  why: string;
  how: string;
  scriptedLanguage: string | null;
  materialsAndSetup: string | null;
  placement: StrategyPlacement;
  caveat: string | null;
  imageAssetId: string | null;
  referenceAssetId: string | null;
}

export interface BankStrategy {
  id: string;
  institutionId: string;
  title: string;
  why: string;
  how: string;
  scriptedLanguage: string | null;
  materialsAndSetup: string | null;
  defaultPlacement: StrategyPlacement;
  caveat: string | null;
  imageAssetId: string | null;
  referenceAssetId: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface BankAsset {
  id: string;
  institutionId: string;
  label: string;
  storagePath: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  isActive: boolean;
  uploadedBy: string;
  uploadedAt: string;
}

export const PLACEMENT_LABEL: Record<StrategyPlacement, string> = {
  home: "Home",
  school: "School",
  shared: "Shared",
};
