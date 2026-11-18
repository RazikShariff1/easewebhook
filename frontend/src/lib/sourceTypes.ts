import { useEffect, useState } from "react";
import { api } from "./api";

export interface SourceTypeField {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  generated?: boolean;
}

export interface SourceType {
  id: string;
  name: string;
  description?: string;
  category: "generic" | "provider";
  icon: string;
  docs_url?: string;
  fields: SourceTypeField[];
  methods: string[];
  custom_auth: boolean;
  verifies_signatures: boolean;
}

// The catalog never changes at runtime, so it's fetched once per page load.
let cache: Promise<SourceType[]> | undefined;

export function loadSourceTypes(): Promise<SourceType[]> {
  cache ??= api.get<SourceType[]>("/source-types").catch((e) => {
    cache = undefined;
    throw e;
  });
  return cache;
}

export function useSourceTypes(): SourceType[] {
  const [types, setTypes] = useState<SourceType[]>([]);
  useEffect(() => {
    loadSourceTypes().then(setTypes).catch(() => setTypes([]));
  }, []);
  return types;
}
