"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  BadgeInfo,
  Bot,
  BrainCircuit,
  Database,
  Loader2,
  PencilLine,
  Plus,
  RefreshCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import {
  createOpenRouterModel,
  deleteOpenRouterModel,
  getOpenRouterModel,
  getOpenRouterModels,
  type OpenRouterModel,
  type UpsertOpenRouterModelPayload,
  updateOpenRouterModel,
} from "@/lib/features/admin/adminAPI";
import { ModelIcon } from "@/components/shared/model-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { ModelDeleteAction } from "./model-delete-action";
import { ModelEditor } from "./model-editor";

const emptyMessage =
  "No models found. Create the first catalog entry to make it available to Builder.";

const sortModels = (models: OpenRouterModel[]) =>
  [...models].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return Number(right.is_active) - Number(left.is_active);
    }

    const nameCompare = left.name.localeCompare(right.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.id.localeCompare(right.id);
  });

const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value === 0 ? 0 : 2,
    maximumFractionDigits: 6,
  }).format(value);

const getModelTags = (model: OpenRouterModel) => model.tags ?? [];

export function ModelCatalog() {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDescriptionUuids, setExpandedDescriptionUuids] = useState<string[]>([]);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorModel, setEditorModel] = useState<OpenRouterModel | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [busyModelUuids, setBusyModelUuids] = useState<string[]>([]);
  const editorRequestRef = useRef(0);

  const loadModels = async () => {
    try {
      setLoading(true);
      const data = await getOpenRouterModels();
      setModels(sortModels(data));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadModels();
  }, []);

  const filteredModels = useMemo(() => {
    if (!searchTerm.trim()) {
      return models;
    }

    const query = searchTerm.toLowerCase();
    return models.filter((model) =>
      [
        model.uuid,
        model.id,
        model.name,
        model.description,
        ...getModelTags(model),
        model.selection_hint,
        model.advanced_info,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [models, searchTerm]);

  const activeCount = models.filter((model) => model.is_active).length;
  const reasoningCount = models.filter((model) => model.is_reasoning).length;
  const toggleDescription = (uuid: string) => {
    setExpandedDescriptionUuids((current) =>
      current.includes(uuid) ? current.filter((item) => item !== uuid) : [...current, uuid],
    );
  };

  const markBusy = (uuid: string, busy: boolean) => {
    setBusyModelUuids((current) => {
      if (busy) {
        return current.includes(uuid) ? current : [...current, uuid];
      }

      return current.filter((item) => item !== uuid);
    });
  };

  const replaceModel = (nextModel: OpenRouterModel) => {
    setModels((current) => {
      const next = current.some((model) => model.uuid === nextModel.uuid)
        ? current.map((model) => (model.uuid === nextModel.uuid ? nextModel : model))
        : [...current, nextModel];

      return sortModels(next);
    });
  };

  const removeModel = (uuid: string) => {
    setModels((current) => current.filter((model) => model.uuid !== uuid));
  };

  const openCreateEditor = () => {
    editorRequestRef.current += 1;
    setEditorMode("create");
    setEditorModel(null);
    setEditorLoading(false);
    setEditorOpen(true);
  };

  const openEditEditor = async (uuid: string) => {
    const requestId = editorRequestRef.current + 1;
    editorRequestRef.current = requestId;

    try {
      setEditorMode("edit");
      setEditorModel(null);
      setEditorLoading(true);
      setEditorOpen(true);
      const model = await getOpenRouterModel(uuid);
      if (editorRequestRef.current !== requestId) {
        return;
      }
      setEditorModel(model);
    } catch (err: unknown) {
      if (editorRequestRef.current !== requestId) {
        return;
      }
      setEditorOpen(false);
      toast.error(err instanceof Error ? err.message : "Failed to load model");
    } finally {
      if (editorRequestRef.current === requestId) {
        setEditorLoading(false);
      }
    }
  };

  const handleEditorOpenChange = (open: boolean) => {
    if (!open) {
      editorRequestRef.current += 1;
      setEditorLoading(false);
      setEditorModel(null);
    }

    setEditorOpen(open);
  };

  const handleSave = async (payload: UpsertOpenRouterModelPayload) => {
    try {
      setEditorSubmitting(true);

      const savedModel =
        editorMode === "create" || !editorModel
          ? await createOpenRouterModel(payload)
          : await updateOpenRouterModel(editorModel.uuid, payload);

      replaceModel(savedModel);
      setEditorOpen(false);
      toast.success(
        editorMode === "create"
          ? "Model catalog entry created"
          : "Model catalog entry updated",
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setEditorSubmitting(false);
    }
  };

  const handleToggleActive = async (model: OpenRouterModel, checked: boolean) => {
    try {
      markBusy(model.uuid, true);
      const latestModel = await getOpenRouterModel(model.uuid);
      const updated = await updateOpenRouterModel(model.uuid, {
        id: latestModel.id,
        name: latestModel.name,
        description: latestModel.description,
        tags: getModelTags(latestModel),
        selection_hint: latestModel.selection_hint ?? "",
        advanced_info: latestModel.advanced_info ?? "",
        context_length: latestModel.context_length,
        input_price: latestModel.input_price,
        output_price: latestModel.output_price,
        is_reasoning: latestModel.is_reasoning,
        is_active: checked,
      });
      replaceModel(updated);
      toast.success(checked ? "Model activated" : "Model deactivated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update activation");
    } finally {
      markBusy(model.uuid, false);
    }
  };

  const handleDelete = async (model: OpenRouterModel) => {
    try {
      await deleteOpenRouterModel(model.uuid);
      removeModel(model.uuid);
      toast.success("Model deleted from catalog");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete model");
      throw err;
    }
  };

  return (
    <>
      <Card className="glass-card overflow-hidden border-white/20 shadow-xl">
        <CardHeader className="border-b border-white/10 bg-white/5 pb-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-purple-600 via-fuchsia-600 to-blue-600">
                OpenRouter Model Catalog
              </CardTitle>
              <CardDescription className="max-w-2xl text-gray-500">
                Curate every OpenRouter model record available to Builder without
                touching the database directly. Search, edit, activate, and retire
                entries from one admin surface.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search uuid, id, name..."
                  className="h-10 w-full min-w-72 bg-white/60 pl-9 border-white/30 focus:border-purple-400"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadModels()}
                disabled={loading}
                className="h-10 rounded-xl border-white/30 bg-white/60"
              >
                <RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button
                type="button"
                onClick={openCreateEditor}
                className="h-10 rounded-xl bg-linear-to-r from-purple-600 to-blue-600 shadow-lg"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Model
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/20 bg-white/45 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                <Database className="h-4 w-4" />
                Catalog Size
              </div>
              <div className="mt-3 text-3xl font-bold text-gray-900">{models.length}</div>
              <p className="mt-1 text-sm text-gray-500">Total managed OpenRouter entries</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/45 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                <Activity className="h-4 w-4" />
                Active Models
              </div>
              <div className="mt-3 text-3xl font-bold text-emerald-600">{activeCount}</div>
              <p className="mt-1 text-sm text-gray-500">Currently selectable in Builder</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/45 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                <BrainCircuit className="h-4 w-4" />
                Reasoning Tagged
              </div>
              <div className="mt-3 text-3xl font-bold text-indigo-600">{reasoningCount}</div>
              <p className="mt-1 text-sm text-gray-500">Flagged for deeper reasoning workloads</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading && models.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-20">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
              <p className="text-sm font-medium text-gray-500">
                Fetching OpenRouter catalog...
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
              <div className="rounded-full border border-red-200 bg-red-50 p-3 text-red-500">
                <Database className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-900">Unable to load model catalog</p>
                <p className="text-sm text-gray-500">{error}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadModels()}
                className="rounded-xl border-white/30 bg-white/60"
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[32%]" />
                  <col className="w-[17%]" />
                  <col className="w-[22%]" />
                  <col className="w-[16%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-white/10 bg-white/5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-6 py-4">Model</th>
                    <th className="px-6 py-4">UUID</th>
                    <th className="px-6 py-4">Runtime Profile</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredModels.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center gap-3 opacity-70">
                          <Bot className="h-10 w-10 text-gray-400" />
                          <span className="font-medium text-gray-600">
                            {models.length === 0 ? emptyMessage : "No models match your search."}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredModels.map((model) => {
                      const isBusy = busyModelUuids.includes(model.uuid);
                      const isDescriptionExpanded = expandedDescriptionUuids.includes(model.uuid);
                      const hasDescription = Boolean(model.description?.trim());
                      const canToggleDescription =
                        hasDescription && model.description.trim().length > 140;

                      return (
                        <tr
                          key={model.uuid}
                          className="group transition-all duration-200 hover:bg-white/5"
                        >
                          <td className="px-6 py-5 align-middle">
                            <div className="flex items-start gap-4">
                              <ModelIcon
                                src={model.icon}
                                name={model.name}
                                size={40}
                                className="mt-1 shrink-0 border border-white/40 shadow-sm"
                                isReasoning={model.is_reasoning}
                              />
                              <div className="space-y-2 pr-4 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-bold text-gray-900 group-hover:text-purple-700">
                                    {model.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {getModelTags(model).map((tag) => (
                                  <Badge
                                    key={`${model.uuid}-${tag}`}
                                    variant="outline"
                                    className="border-purple-200 bg-purple-50 text-purple-700"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {model.is_reasoning ? (
                                  <Badge
                                    variant="outline"
                                    className="border-indigo-200 bg-indigo-50 text-indigo-600"
                                  >
                                    Reasoning
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="break-words font-mono text-xs text-gray-500">{model.id}</p>
                              {model.selection_hint?.trim() ? (
                                <p className="text-sm font-medium leading-6 text-gray-700">
                                  {model.selection_hint.trim()}
                                </p>
                              ) : null}
                              <div className="space-y-2">
                                <p
                                  className={cn(
                                    "text-sm leading-6 text-gray-600",
                                    canToggleDescription &&
                                      !isDescriptionExpanded &&
                                      "max-h-[4.5rem] overflow-hidden",
                                  )}
                                >
                                  {model.description || "No description provided"}
                                </p>
                                {canToggleDescription ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleDescription(model.uuid)}
                                    aria-expanded={isDescriptionExpanded}
                                    className="text-xs font-semibold text-purple-700 hover:text-purple-800"
                                  >
                                    {isDescriptionExpanded ? "Show less" : "Show more"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="w-full rounded-2xl border border-white/20 bg-white/45 px-3 py-2 font-mono text-xs leading-5 text-gray-600 break-all">
                              {model.uuid}
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="space-y-3 text-sm text-gray-600">
                              <div className="flex items-center gap-2">
                                <Bot className="h-4 w-4 text-gray-400" />
                                <span>{model.context_length.toLocaleString()} context</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <BadgeDollarSign className="h-4 w-4 text-gray-400" />
                                <span>In {formatPrice(model.input_price)}</span>
                                <span className="text-gray-300">/</span>
                                <span>Out {formatPrice(model.output_price)}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <BadgeInfo className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                                <span className="line-clamp-2 text-sm leading-6 text-gray-500">
                                  {model.advanced_info?.trim()
                                    ? model.advanced_info.trim()
                                    : "No advanced guidance added"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="space-y-3">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border font-medium",
                                  model.is_active
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-gray-200 bg-gray-50 text-gray-500",
                                )}
                              >
                                {model.is_active ? "Active" : "Inactive"}
                              </Badge>
                              <div className="flex items-center gap-3">
                                <Switch
                                  checked={model.is_active}
                                  disabled={isBusy}
                                  onCheckedChange={(checked) =>
                                    void handleToggleActive(model, checked)
                                  }
                                  aria-label={`Toggle active for ${model.name}`}
                                />
                                <span className="text-xs font-medium text-gray-500">
                                  {isBusy
                                    ? "Updating..."
                                    : model.is_active
                                      ? "Visible in Builder"
                                      : "Hidden from Builder"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void openEditEditor(model.uuid)}
                                aria-label={`Edit ${model.name}`}
                                className="h-8 rounded-lg border-purple-200 bg-white/65 px-3 text-xs font-bold text-purple-700 hover:bg-purple-50"
                              >
                                <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <ModelDeleteAction
                                modelName={model.name}
                                onConfirm={() => handleDelete(model)}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ModelEditor
        open={editorOpen}
        mode={editorMode}
        model={editorModel}
        isLoading={editorLoading}
        isSubmitting={editorSubmitting}
        onOpenChange={handleEditorOpenChange}
        onSubmit={handleSave}
      />
    </>
  );
}
