"use client";

import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Sparkles, X } from "lucide-react";

import type {
  OpenRouterModel,
  UpsertOpenRouterModelPayload,
} from "@/lib/features/admin/adminAPI";
import { ModelIcon } from "@/components/shared/model-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const commonModelTags = ["Swift", "Steady", "Deep"];

const requiredNumberField = (
  label: string,
  options?: { integer?: boolean; greaterThan?: number },
) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => !Number.isNaN(Number(value)), `${label} is required`)
    .refine(
      (value) =>
        options?.greaterThan === undefined
          ? Number(value) >= 0
          : Number(value) > options.greaterThan,
      options?.greaterThan === undefined
        ? `${label} cannot be negative`
        : `${label} must be greater than ${options.greaterThan}`,
    )
    .refine(
      (value) => !options?.integer || Number.isInteger(Number(value)),
      `${label} must be a whole number`,
    )
    .transform((value) => Number(value));

const normalizeTag = (tag: string) => tag.trim();

const normalizeTagArray = (tags?: string[] | null) =>
  (tags ?? []).reduce<string[]>((nextTags, tag) => {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag) {
      return nextTags;
    }

    if (nextTags.some((value) => value.toLowerCase() === normalizedTag.toLowerCase())) {
      return nextTags;
    }

    nextTags.push(normalizedTag);
    return nextTags;
  }, []);

const appendTag = (tags: string[], nextTag: string) =>
  normalizeTagArray([...tags, nextTag]);

const modelFormSchema = z.object({
  id: z.string().trim().min(1, "Model id is required"),
  name: z.string().trim().min(1, "Display name is required"),
  description: z.string().default(""),
  tags: z
    .array(z.string())
    .transform(normalizeTagArray)
    .refine((tags) => tags.length > 0, "Select or add at least one tag"),
  selection_hint: z.string().default(""),
  advanced_info: z.string().default(""),
  context_length: requiredNumberField("Context length", {
    integer: true,
    greaterThan: 0,
  }),
  input_price: requiredNumberField("Input price"),
  output_price: requiredNumberField("Output price"),
  is_reasoning: z.boolean(),
  is_active: z.boolean(),
  icon: z.string().optional().nullable(),
  icon_file: z.instanceof(File).optional().nullable(),
});

type ModelEditorValues = z.input<typeof modelFormSchema>;
type ModelEditorSubmitValues = z.output<typeof modelFormSchema>;

const defaultValues: ModelEditorValues = {
  id: "",
  name: "",
  description: "",
  tags: [],
  selection_hint: "",
  advanced_info: "",
  context_length: "",
  input_price: "",
  output_price: "",
  is_reasoning: false,
  is_active: true,
  icon: null,
  icon_file: null,
};

const getFormValues = (
  model: OpenRouterModel | null | undefined,
): ModelEditorValues => {
  if (!model) {
    return defaultValues;
  }

  return {
    id: model.id,
    name: model.name,
    description: model.description ?? "",
    tags: normalizeTagArray(model.tags),
    selection_hint: model.selection_hint ?? "",
    advanced_info: model.advanced_info ?? "",
    context_length: String(model.context_length),
    input_price: String(model.input_price),
    output_price: String(model.output_price),
    is_reasoning: model.is_reasoning,
    is_active: model.is_active,
    icon: model.icon ?? null,
    icon_file: null,
  };
};

interface ModelEditorProps {
  open: boolean;
  mode: "create" | "edit";
  model?: OpenRouterModel | null;
  isLoading?: boolean;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: UpsertOpenRouterModelPayload) => Promise<void>;
}

export function ModelEditor({
  open,
  mode,
  model,
  isLoading = false,
  isSubmitting = false,
  onOpenChange,
  onSubmit,
}: ModelEditorProps) {
  const form = useForm<ModelEditorValues, unknown, ModelEditorSubmitValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues,
  });
  const liveValues = useWatch({
    control: form.control,
    defaultValue: defaultValues,
  });
  const [showSidebar, setShowSidebar] = useState(false);
  const [customTag, setCustomTag] = useState("");

  useEffect(() => {
    if (open) {
      form.reset(getFormValues(model));
      setCustomTag("");
    }
  }, [form, model, open]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1536px)");
    const updateSidebarVisibility = () => {
      setShowSidebar(mediaQuery.matches);
    };

    updateSidebarVisibility();
    mediaQuery.addEventListener("change", updateSidebarVisibility);

    return () => {
      mediaQuery.removeEventListener("change", updateSidebarVisibility);
    };
  }, []);

  const handleSubmit = async (values: ModelEditorSubmitValues) => {
    await onSubmit({
      id: values.id.trim(),
      name: values.name.trim(),
      description: values.description.trim(),
      tags: normalizeTagArray(values.tags),
      selection_hint: values.selection_hint.trim(),
      advanced_info: values.advanced_info.trim(),
      context_length: values.context_length,
      input_price: values.input_price,
      output_price: values.output_price,
      is_reasoning: values.is_reasoning,
      is_active: values.is_active,
      icon: values.icon ?? null,
      icon_file: values.icon_file || null,
    });
  };

  const currentState = {
    mode: mode === "create" ? "Create" : "Edit",
    tag: normalizeTagArray(liveValues.tags)[0] || "Unlabeled",
    tagCount: `${normalizeTagArray(liveValues.tags).length} tag${
      normalizeTagArray(liveValues.tags).length === 1 ? "" : "s"
    }`,
    visibility: liveValues.is_active ? "Active" : "Inactive",
    reasoning: liveValues.is_reasoning ? "Enabled" : "Disabled",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 z-[110] flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[min(64rem,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border-white/20 bg-background p-0 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out sm:max-h-[calc(100vh-2rem)] sm:max-w-[min(72rem,calc(100vw-2rem))] xl:max-w-[min(96rem,calc(100vw-2rem))] 2xl:max-w-[min(132rem,calc(100vw-3rem))] glass-strong">
        <DialogHeader className="shrink-0 border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-linear-to-r from-purple-600 to-blue-600">
            {mode === "create" ? "Register OpenRouter Model" : "Edit Model Record"}
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            Manage the catalog entry admins expose to Builder users. All pricing,
            capability, and activation fields are editable here.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            <p className="text-sm font-medium text-gray-500">
              Loading model details...
            </p>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div
              className={`grid min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${
                showSidebar ? "2xl:grid-cols-[minmax(24rem,0.72fr)_minmax(0,1.28fr)]" : ""
              }`}
            >
              {showSidebar ? (
                <aside className="min-w-0 border-b border-white/10 bg-white/5 px-6 py-5 2xl:border-b-0 2xl:border-r">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                        Catalog Snapshot
                      </p>
                      <p className="text-sm leading-6 text-gray-600">
                        Keep the record readable for admins and obvious for Builder users.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/20 bg-white/50 p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                        Current State
                      </p>
                      <div className="mt-3 space-y-3 text-sm text-gray-600">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500">Mode</span>
                          <span className="font-medium text-gray-900">{currentState.mode}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500">Tag</span>
                          <div className="text-right">
                            <span className="font-medium text-gray-900">{currentState.tag}</span>
                            <p className="text-xs text-gray-500">{currentState.tagCount}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500">Visibility</span>
                          <span className="font-medium text-gray-900">
                            {currentState.visibility}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500">Reasoning</span>
                          <span className="font-medium text-gray-900">
                            {currentState.reasoning}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/20 bg-white/50 p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                        Editing Notes
                      </p>
                      <p className="mt-2 text-sm leading-6 text-gray-600">
                        The right side carries the full form. Keep the model id stable, and use
                        the pricing fields to reflect the current OpenRouter catalog.
                      </p>
                    </div>
                  </div>
                </aside>
              ) : null}

              <div
                className={`grid min-w-0 gap-4 px-6 py-5 ${
                  showSidebar ? "lg:grid-cols-2 2xl:gap-5" : "grid-cols-1 md:grid-cols-2 2xl:gap-5"
                }`}
              >
                <div className={showSidebar ? "sm:col-span-2" : "md:col-span-2"}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">
                    Provider Branding
                  </p>
                  <Controller
                    control={form.control}
                    name="icon_file"
                    render={({ field: { onChange, value: _value }, fieldState }) => {
                      const iconUrl = liveValues.icon;
                      const [localPreview, setLocalPreview] = useState<string | null>(null);

                      return (
                        <div className="flex items-center gap-6 rounded-2xl border border-white/20 bg-white/35 p-5">
                          <div className="shrink-0">
                            <ModelIcon
                              src={localPreview || iconUrl}
                              name={liveValues.name}
                              size={80}
                              className="border-2 border-white/40 shadow-inner"
                              isReasoning={liveValues.is_reasoning}
                            />
                          </div>
                          <div className="flex-1 space-y-3">
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor="model-icon">Model Icon (PNG)</FieldLabel>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input
                                  id="model-icon"
                                  type="file"
                                  accept="image/png"
                                  disabled={isSubmitting}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      onChange(file);
                                      const url = URL.createObjectURL(file);
                                      setLocalPreview(url);
                                    }
                                  }}
                                  className="h-10 bg-white/60 border-white/30 file:mr-4 file:rounded-md file:border-0 file:bg-purple-600 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-purple-700"
                                />
                                {localPreview && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      onChange(null);
                                      setLocalPreview(null);
                                    }}
                                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                                  >
                                    Clear Selection
                                  </Button>
                                )}
                              </div>
                              <FieldDescription>
                                Upload a high-quality PNG. We hash the file for security and
                                serve it via CDN.
                              </FieldDescription>
                              <FieldError errors={[fieldState.error]} />
                            </Field>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>

                <Controller
                  control={form.control}
                  name="id"
                  render={({ field, fieldState }) => (
                    <Field
                      data-invalid={fieldState.invalid}
                      className={showSidebar ? "sm:col-span-2" : "md:col-span-2"}
                    >
                      <FieldLabel htmlFor="model-id">Model ID</FieldLabel>
                      <Input
                        {...field}
                        id="model-id"
                        placeholder="openai/gpt-4.1-mini"
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>
                        Stable provider/model id used by Builder and saved selections.
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="model-name">Display Name</FieldLabel>
                      <Input
                        {...field}
                        id="model-name"
                        placeholder="GPT-4.1 Mini"
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="tags"
                  render={({ field, fieldState }) => (
                    <Field
                      data-invalid={fieldState.invalid}
                      className={showSidebar ? "sm:col-span-2" : "md:col-span-2"}
                    >
                      <FieldLabel>Tags</FieldLabel>
                      <div className="space-y-3 rounded-2xl border border-white/20 bg-white/35 p-4">
                        <div className="flex flex-wrap gap-2">
                          {commonModelTags.map((tag) => {
                            const selectedTags = normalizeTagArray(field.value);
                            const isSelected = selectedTags.some(
                              (value) => value.toLowerCase() === tag.toLowerCase(),
                            );

                            return (
                              <Button
                                key={tag}
                                type="button"
                                variant={isSelected ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  if (isSelected) {
                                    field.onChange(
                                      selectedTags.filter(
                                        (value) => value.toLowerCase() !== tag.toLowerCase(),
                                      ),
                                    );
                                    return;
                                  }

                                  field.onChange(appendTag(selectedTags, tag));
                                }}
                                disabled={isSubmitting}
                                aria-label={`${isSelected ? "Remove" : "Add"} ${tag} tag`}
                                className={
                                  isSelected
                                    ? "rounded-full bg-linear-to-r from-purple-600 to-blue-600"
                                    : "rounded-full border-purple-200 bg-white/80 text-purple-700 hover:bg-purple-50"
                                }
                              >
                                {isSelected ? `${tag} selected` : `Add ${tag}`}
                              </Button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {normalizeTagArray(field.value).map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="h-auto rounded-full border-purple-200 bg-purple-50 px-2.5 py-1 text-purple-700"
                            >
                              <span>{tag}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  field.onChange(
                                    normalizeTagArray(field.value).filter(
                                      (value) => value.toLowerCase() !== tag.toLowerCase(),
                                    ),
                                  )
                                }
                                aria-label={`Remove ${tag} tag`}
                                className="ml-1 rounded-full text-purple-500 transition hover:text-purple-700"
                                disabled={isSubmitting}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                          {normalizeTagArray(field.value).length === 0 && (
                            <span className="text-sm text-gray-500">
                              No tags selected yet.
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id="custom-tag"
                            value={customTag}
                            placeholder="Add a custom tag"
                            disabled={isSubmitting}
                            aria-invalid={fieldState.invalid}
                            aria-label="Custom tag"
                            onChange={(event) => setCustomTag(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") {
                                return;
                              }

                              event.preventDefault();
                              const nextTag = normalizeTag(customTag);
                              if (!nextTag) {
                                return;
                              }

                              field.onChange(
                                appendTag(normalizeTagArray(field.value), nextTag),
                              );
                              setCustomTag("");
                            }}
                            className="bg-white/60 border-white/30 focus:border-purple-400"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const nextTag = normalizeTag(customTag);
                              if (!nextTag) {
                                return;
                              }

                              field.onChange(
                                appendTag(normalizeTagArray(field.value), nextTag),
                              );
                              setCustomTag("");
                            }}
                            disabled={isSubmitting || !normalizeTag(customTag)}
                            className="rounded-xl border-purple-200 bg-white/80 text-purple-700 hover:bg-purple-50"
                          >
                            Add custom tag
                          </Button>
                        </div>
                      </div>
                      <FieldDescription>
                        Choose one or more Builder-facing tags. The first tag becomes the compact
                        badge. <span className="font-medium">{normalizeTagArray(field.value).length} tag{normalizeTagArray(field.value).length === 1 ? "" : "s"}</span>
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="context_length"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="context-length">Context Length</FieldLabel>
                      <Input
                        {...field}
                        id="context-length"
                        type="text"
                        inputMode="numeric"
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>
                        Enter the full context window as a whole number greater than 0.
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="description"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} className="sm:col-span-2">
                      <FieldLabel htmlFor="model-description">Description</FieldLabel>
                      <Textarea
                        {...field}
                        id="model-description"
                        rows={3}
                        placeholder="Describe when admins or builders should prefer this model."
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="min-h-24 bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="selection_hint"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} className="sm:col-span-2">
                      <FieldLabel htmlFor="selection-hint">Selection Hint</FieldLabel>
                      <Textarea
                        {...field}
                        id="selection-hint"
                        rows={2}
                        placeholder="Explain in one short line when Builder users should choose this model."
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="min-h-20 bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>
                        Short guidance shown in model selection surfaces.
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="advanced_info"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} className="sm:col-span-2">
                      <FieldLabel htmlFor="advanced-info">Advanced Info</FieldLabel>
                      <Textarea
                        {...field}
                        id="advanced-info"
                        rows={4}
                        placeholder="Summarize the model's strengths, tradeoffs, and ideal use cases for the Advanced panel."
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="min-h-28 bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>
                        Longer admin-curated guidance for users who open advanced model details.
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="input_price"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="input-price">Input Price</FieldLabel>
                      <Input
                        {...field}
                        id="input-price"
                        type="number"
                        min={0}
                        step="0.000001"
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>Price per input unit from OpenRouter.</FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="output_price"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="output-price">Output Price</FieldLabel>
                      <Input
                        {...field}
                        id="output-price"
                        type="number"
                        min={0}
                        step="0.000001"
                        disabled={isSubmitting}
                        aria-invalid={fieldState.invalid}
                        className="bg-white/60 border-white/30 focus:border-purple-400"
                      />
                      <FieldDescription>Price per output unit from OpenRouter.</FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="is_reasoning"
                  render={({ field }) => (
                    <Field className="rounded-2xl border border-white/20 bg-white/35 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <FieldLabel htmlFor="is-reasoning">Reasoning Model</FieldLabel>
                          <FieldDescription>
                            Mark models intended for deliberate reasoning and chain-of-thought
                            style tasks.
                          </FieldDescription>
                        </div>
                        <Switch
                          id="is-reasoning"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmitting}
                        />
                      </div>
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="is_active"
                  render={({ field }) => (
                    <Field className="rounded-2xl border border-white/20 bg-white/35 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <FieldLabel htmlFor="is-active">Active in Builder</FieldLabel>
                          <FieldDescription>
                            Inactive models stay in the admin catalog but disappear from Builder
                            selection.
                          </FieldDescription>
                        </div>
                        <Switch
                          id="is-active"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmitting}
                        />
                      </div>
                    </Field>
                  )}
                />
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t border-white/10 bg-background/95 px-6 py-4 backdrop-blur">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="rounded-xl border-white/30 bg-white/55"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-linear-to-r from-purple-600 to-blue-600 shadow-lg"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Save Model
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
