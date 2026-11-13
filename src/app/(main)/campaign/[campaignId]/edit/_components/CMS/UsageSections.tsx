"use client";

import type {
  CollectionFieldUsageResult,
  CollectionUsageResult,
  DependentFieldUsageEntry,
  UsageEntry,
} from "@/lib/collection-usage-scan";

/**
 * Renders the "still in use" breakdown shown by the delete-collection and
 * delete-field dialogs. Pure presentation of the server's usage result.
 */

function UsageGroup({
  title,
  count,
  unit,
  children,
}: {
  title: string;
  count: number;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
        <span className="text-foreground">{title}</span>
        <span>&mdash;</span>
        <span>
          {count} {unit}
          {count > 1 ? "s" : ""}
        </span>
      </div>
      <ul className="list-disc list-inside space-y-0.5 ml-1">{children}</ul>
    </div>
  );
}

function EntryList({ entries }: { entries: UsageEntry[] }) {
  return (
    <>
      {entries.map((e) => (
        <li key={e.id}>{e.name}</li>
      ))}
    </>
  );
}

function FieldEntryList({ entries }: { entries: DependentFieldUsageEntry[] }) {
  return (
    <>
      {entries.map((f) => (
        <li key={f.id}>
          Field &quot;{f.name}&quot; in &quot;{f.collectionName}&quot;
        </li>
      ))}
    </>
  );
}

export function CollectionUsageSections({
  usage,
}: {
  usage: CollectionUsageResult;
}) {
  return (
    <div className="space-y-2 text-muted-foreground">
      {usage.pages.length > 0 && (
        <UsageGroup title="Pages" count={usage.pages.length} unit="item">
          <EntryList entries={usage.pages} />
        </UsageGroup>
      )}
      {usage.components.length > 0 && (
        <UsageGroup
          title="Components"
          count={usage.components.length}
          unit="item"
        >
          <EntryList entries={usage.components} />
        </UsageGroup>
      )}
      {usage.referenceFields.length > 0 && (
        <UsageGroup
          title="Reference & count fields"
          count={usage.referenceFields.length}
          unit="field"
        >
          <FieldEntryList entries={usage.referenceFields} />
        </UsageGroup>
      )}
    </div>
  );
}

export function FieldUsageSections({
  usage,
}: {
  usage: CollectionFieldUsageResult;
}) {
  return (
    <div className="space-y-2 text-muted-foreground">
      {usage.pages.length > 0 && (
        <UsageGroup title="Pages" count={usage.pages.length} unit="item">
          <EntryList entries={usage.pages} />
        </UsageGroup>
      )}
      {usage.components.length > 0 && (
        <UsageGroup
          title="Components"
          count={usage.components.length}
          unit="item"
        >
          <EntryList entries={usage.components} />
        </UsageGroup>
      )}
      {usage.dependentFields.length > 0 && (
        <UsageGroup
          title="Count fields"
          count={usage.dependentFields.length}
          unit="field"
        >
          <FieldEntryList entries={usage.dependentFields} />
        </UsageGroup>
      )}
    </div>
  );
}
