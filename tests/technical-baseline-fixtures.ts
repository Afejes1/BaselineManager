import type { TechnicalBaselineRow } from "../lib/technical-baseline-contract.js";

export const hostOnlyRow: TechnicalBaselineRow = {
  "#": "H-17", ReleaseName: "MXP 1", Tier: "Infrastructure", Resource: "Server",
  HW_Host: "host-a", HW_Storage_Type: "SSD", "HW_Storage (GB)": 0,
  HW_CPU_CORES: 0, "HW_RAM (GB)": 0, Notes: "host-only", "Notes.1": "retain",
  "Notes.2": "", "Notes.3": null, "Notes.4": "source note",
};

export const productOnTwoPlatforms: TechnicalBaselineRow[] = [
  { "#": "P-1", ReleaseName: "MXP 1", Tier: "Application", Resource: "Linux", HW_Host: "host-a", LongName: "Flight Service", ShortName: "FS", "HW_CPU_CORES": 0, Notes: "first" },
  { "#": "P-2", ReleaseName: " mxp   1 ", Tier: " application ", Resource: "Windows", HW_Host: "host-b", LongName: " flight service ", ShortName: "FS", "HW_CPU_CORES": "0", Notes: "second" },
];

export const productAcrossTwoReleases: TechnicalBaselineRow[] = [
  { "#":"101", ReleaseName:"30P05", Tier:"Mission Systems", Resource:"ALIS Core", HW_Host:"host-a", LongName:"Operational Data Integrated Network", ShortName:"ODIN", HW_CPU_CORES:12 },
  { "#":"202", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", HW_Host:"host-a", LongName:"Operational Data Integrated Network", ShortName:"ODIN", HW_CPU_CORES:16 },
];

export const allContractValues: TechnicalBaselineRow = Object.fromEntries([
  ["#", "42"], ...Array.from({ length: 23 }, (_, index) => [
    ["ReleaseName", "Tier", "Resource", "TechStackType", "ShortName", "HW_Host", "HW_Storage_Type", "HW_Storage (GB)", "HW_CPU_CORES", "HW_RAM (GB)", "SW Language", "Software Type", "OEM", "Containerized", "Container Technology", "Container Type", "LongName", "Notes", "Technical Capability Satisfied by this SW/Tech - Notes", "Notes.1", "Notes.2", "Notes.3", "Notes.4"][index], `v-${index + 1}`,
  ]),
]) as TechnicalBaselineRow;
