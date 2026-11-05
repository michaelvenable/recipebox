import { type FormEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import { type QueryClient, useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EditorRecipe, PublicRecipe, RecipeContentInput } from "@recipebox/shared";
import { useBlocker, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client.js";
import { recipeKeys } from "../api/query-keys.js";
import { createRecipe, removePhoto, saveRecipeContent, uploadPhoto } from "../api/recipes.js";
import { TopBar } from "../layout/top-bar.js";
import { EntryList } from "./EntryList.js";
import { photoChanged } from "./photo-version.js";
import { KEEP_PHOTO, type PhotoChange, PhotoField } from "./PhotoField.js";
import { changeErrorMessage, showSavedRecipe } from "./recipe-changes.js";
import {
  type Entry,
  type FormErrors,
  type FormValues,
  NO_ERRORS,
  contentInput,
  contentSnapshot,
  formErrors,
  formFrom,
  obviousErrors,
  tagField,
  withTag,
} from "./recipe-form.js";
import { RecipeTags, type TagEditing } from "./RecipeTags.js";

interface SavePlan {
  /** The recipe to change, or undefined to create it. */
  id: string | undefined;
  /** The content to send, or undefined when it is unchanged since it was last saved. */
  content: RecipeContentInput | undefined;
  photo: PhotoChange;
}

interface SaveResult {
  id: string;
  /** The recipe as last saved by this save, or undefined if nothing was. */
  recipe: EditorRecipe | undefined;
  /** Why the photo upload or removal failed, after the content was saved. */
  photoError?: unknown;
}

/**
 * The content first, then the photo, which needs the recipe to exist (REC-1, REC-7). Each saved step goes into the cache at once,
 * so if the photo then fails, the content is saved and shown everywhere, and only the photo is left to try again.
 */
async function save(queryClient: QueryClient, { id, content, photo }: SavePlan): Promise<SaveResult> {
  let recipe: EditorRecipe | undefined;
  if (content !== undefined) {
    recipe = id === undefined ? await createRecipe(content) : await saveRecipeContent(id, content);
    showSavedRecipe(queryClient, recipe, { tagsChanged: true });
  }
  const savedId = recipe?.id ?? id;
  if (savedId === undefined) throw new Error("A new recipe's content must be saved before its photo.");
  if (photo.kind === "keep") return { id: savedId, recipe };
  try {
    const withPhoto = photo.kind === "new" ? await uploadPhoto(savedId, photo.file) : await removePhoto(savedId);
    photoChanged(queryClient, savedId);
    showSavedRecipe(queryClient, withPhoto, { tagsChanged: false });
    return { id: savedId, recipe: withPhoto };
  } catch (error) {
    return { id: savedId, recipe, photoError: error };
  }
}

/** A refused save: the server's errors sorted into the form's fields, or why it didn't get through. */
function errorsOf(error: unknown, sent: FormValues): FormErrors {
  if (error instanceof ApiError && error.errors.length > 0) return formErrors(error.errors, sent);
  return { fields: new Map(), general: [changeErrorMessage(error)] };
}

/**
 * A failed upload or removal. The photo's own errors (photo.tooLarge, photo.unsupportedType, photo.unreadable, photo.busy, ...)
 * go next to the photo with the server's message; anything else, such as the recipe being in the trash (REC-17), goes on top.
 */
function photoErrorsOf(error: unknown): FormErrors {
  if (error instanceof ApiError && error.errors.length > 0 && error.errors.every((e) => e.code.startsWith("photo."))) {
    return { fields: new Map([["photo", error.errors.map((e) => e.message)]]), general: [] };
  }
  return { fields: new Map(), general: [changeErrorMessage(error)] };
}

interface Problem {
  errors: FormErrors;
  /** The content was saved and only the photo failed. */
  contentSaved: boolean;
  /** The photo change that was tried, so its error goes once the editor picks another. */
  photo: PhotoChange;
}

function recipePath(id: string): string {
  return `/recipes/${encodeURIComponent(id)}`;
}

/**
 * Creating a recipe (REC-1) at /recipes/new, or editing one (REC-5) at /recipes/:id/edit. Cancel and Save take the place of the
 * navigation row, so a stray tap can't leave the form (docs/mockups/README.md, "Edit form"); leaving with unsaved changes asks
 * first, and closing or reloading the page makes the browser warn.
 */
export function RecipeForm({ recipe }: { recipe: PublicRecipe | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const id = useId();

  const [initial] = useState(() => formFrom(recipe));
  const [form, setForm] = useState(initial);
  const [photo, setPhoto] = useState<PhotoChange>(KEEP_PHOTO);
  // The recipe as last saved: its id once created, the content then sent, and whether it has a photo.
  const [saved, setSaved] = useState(() => ({ id: recipe?.id, content: contentSnapshot(initial), hasPhoto: recipe?.hasPhoto ?? false }));
  const [problem, setProblem] = useState<Problem>();
  const [askingToDiscard, setAskingToDiscard] = useState(false);
  // A tag typed but not yet added (REC-10): Save adds it rather than dropping it, and leaving asks first.
  const [tagDraft, setTagDraft] = useState("");

  const dirty = contentSnapshot(form) !== saved.content || photo.kind !== "keep" || tagDraft.trim() !== "";
  // Set just before leaving on purpose (after saving, or discarding), so the leaving isn't stopped to ask.
  const leaving = useRef(false);
  // A save outlives the form if the editor is signed out meanwhile; then it must not navigate from whatever page is shown.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const cancelButton = useRef<HTMLButtonElement>(null);

  // The recipe's own key, so its view waits while this saves, and this waits for a change made there (COOK-1).
  const mutationKey = saved.id === undefined ? recipeKeys.create() : recipeKeys.change(saved.id);
  const mutation = useMutation({ mutationKey, mutationFn: (plan: SavePlan) => save(queryClient, plan) });
  const busy = useIsMutating({ mutationKey }) > 0;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set to show their warning.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problem !== undefined) summary.current?.focus();
  }, [problem]);

  function leave() {
    leaving.current = true;
    // Back where the editor came from, if that was in the app; otherwise to the recipe, or the list for a recipe never saved.
    if (location.key !== "default") void navigate(-1);
    else void navigate(saved.id === undefined ? "/" : recipePath(saved.id), { replace: true });
  }

  function cancel() {
    if (dirty) setAskingToDiscard(true);
    else leave();
  }

  async function submit() {
    if (busy) return;
    const sent = withTag(form, tagDraft);
    if (sent !== form) setForm(sent);
    setTagDraft("");
    const obvious = obviousErrors(sent);
    if (obvious.length > 0) {
      setProblem({ errors: formErrors(obvious, sent), contentSaved: false, photo });
      return;
    }
    const contentChanged = saved.id === undefined || contentSnapshot(sent) !== saved.content;
    let result: SaveResult;
    try {
      result = await mutation.mutateAsync({ id: saved.id, content: contentChanged ? contentInput(sent) : undefined, photo });
    } catch (error) {
      if (mounted.current) setProblem({ errors: errorsOf(error, sent), contentSaved: false, photo });
      return;
    }
    if (!mounted.current) return;
    if (result.photoError === undefined) {
      leaving.current = true;
      void navigate(recipePath(result.id), { replace: true });
      return;
    }
    // The content is saved; keep the picked photo and the form, now for the saved recipe, so Save tries the photo again.
    setSaved({ id: result.id, content: contentSnapshot(sent), hasPhoto: result.recipe?.hasPhoto ?? saved.hasPhoto });
    setProblem({ errors: photoErrorsOf(result.photoError), contentSaved: true, photo });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  const errors = problem?.errors ?? NO_ERRORS;
  const fieldErrors = errors.fields;
  // A photo error is about the photo that was tried; it goes once another is picked or the photo is removed.
  const photoError = problem !== undefined && problem.photo === photo ? fieldErrors.get("photo") : undefined;
  const set = (change: Partial<FormValues>) => setForm((current) => ({ ...current, ...change }));

  const tagMessages = [
    ...(fieldErrors.get("tags") ?? []),
    ...form.tags.flatMap((tag) => (fieldErrors.get(tagField(tag)) ?? []).map((message) => `“${tag}”: ${message}`)),
  ];
  const tagEditing: TagEditing = {
    // Kept in the form until Save; the server reads each tag and applies the tag rules then (REC-11).
    attach: (typed, done) => {
      setForm((current) => withTag(current, typed));
      done();
    },
    remove: (tag, done) => {
      setForm((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }));
      done();
    },
    busy,
    // Shown with the tags, and tied to the tag field while it is open.
    error: tagMessages.length > 0 ? tagMessages.join(" ") : undefined,
    draft: { text: tagDraft, setText: setTagDraft },
  };

  const nameErrors = fieldErrors.get("name");
  const timeErrors = fieldErrors.get("totalTimeMinutes");
  const confirming = askingToDiscard || blocker.state === "blocked";

  return (
    <div className="recipe-form-page">
      <TopBar>
        <header className="form-bar">
          {/*
            Not while saving: the save would finish after leaving, and its outcome would have nowhere to go. aria-disabled rather
            than disabled, so it can still hold focus, such as after Keep editing during a save.
          */}
          <button
            ref={cancelButton}
            type="button"
            className="form-bar-cancel"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) cancel();
            }}
          >
            Cancel
          </button>
          <h1>{saved.id === undefined ? "New recipe" : "Edit recipe"}</h1>
          <button type="button" className="form-bar-save" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </header>
        {confirming && (
          <DiscardConfirm
            busy={busy}
            discard={() => {
              setAskingToDiscard(false);
              if (blocker.state === "blocked") {
                leaving.current = true;
                blocker.proceed();
              } else {
                leave();
              }
            }}
            keepEditing={() => {
              setAskingToDiscard(false);
              if (blocker.state === "blocked") blocker.reset();
              cancelButton.current?.focus();
            }}
          />
        )}
      </TopBar>

      {problem !== undefined && <Summary ref={summary} problem={problem} />}

      <form id={`${id}-form`} className="recipe-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-fields" disabled={busy}>
          <div className="field">
            <label htmlFor={`${id}-name`} className="field-title">
              Name
            </label>
            <input
              id={`${id}-name`}
              className="text-input"
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              value={form.name}
              aria-invalid={nameErrors !== undefined || undefined}
              aria-describedby={nameErrors !== undefined ? `${id}-name-error` : undefined}
              onChange={(event) => set({ name: event.target.value })}
            />
            {nameErrors !== undefined && (
              <p id={`${id}-name-error`} className="field-error">
                {nameErrors.join(" ")}
              </p>
            )}
          </div>

          <PhotoField recipeId={saved.id} hasPhoto={saved.hasPhoto} change={photo} onChange={setPhoto} error={photoError} />

          <fieldset className="field">
            <legend className="field-title">Total time (optional)</legend>
            <div className="time-inputs">
              <label className="time-input">
                <input
                  className="text-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.hours}
                  aria-invalid={timeErrors !== undefined || undefined}
                  aria-describedby={timeErrors !== undefined ? `${id}-time-error` : undefined}
                  onChange={(event) => set({ hours: event.target.value })}
                />
                <span>hours</span>
              </label>
              <label className="time-input">
                <input
                  className="text-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.minutes}
                  aria-invalid={timeErrors !== undefined || undefined}
                  aria-describedby={timeErrors !== undefined ? `${id}-time-error` : undefined}
                  onChange={(event) => set({ minutes: event.target.value })}
                />
                <span>minutes</span>
              </label>
            </div>
            {timeErrors !== undefined && (
              <p id={`${id}-time-error`} className="field-error">
                {timeErrors.join(" ")}
              </p>
            )}
          </fieldset>

          <EntryList field="ingredients" entries={form.ingredients} onChange={(ingredients: Entry[]) => set({ ingredients })} errors={fieldErrors} />
          <EntryList field="steps" entries={form.steps} onChange={(steps: Entry[]) => set({ steps })} errors={fieldErrors} />
        </fieldset>
      </form>

      {/* After the form, not in it: adding a tag is a form of its own (RecipeTags), and forms can't nest. */}
      <section className="field" aria-labelledby={`${id}-tags`}>
        <h2 id={`${id}-tags`} className="field-title">
          Tags
        </h2>
        <RecipeTags recipeId={saved.id} tags={form.tags} editing={tagEditing} />
        <p className="field-hint">Tags are saved in lowercase. Up to 20 per recipe.</p>
      </section>
    </div>
  );
}

/** At the top of the form after a failed save, and focused, so the editor hears what went wrong and where (REC-1). */
function Summary({ problem, ref }: { problem: Problem; ref: Ref<HTMLDivElement> }) {
  const { errors, contentSaved } = problem;
  const count = errors.fields.size;
  let lead: string;
  if (contentSaved) lead = "The recipe is saved, but the photo isn't.";
  else if (count === 0) lead = "Not saved.";
  else lead = `Not saved. Fix the ${count === 1 ? "field" : `${count} fields`} marked below.`;
  return (
    <div ref={ref} className="form-summary" role="alert" tabIndex={-1}>
      <p>{lead}</p>
      {errors.general.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {contentSaved && errors.fields.has("photo") && <p>Save again to try the photo again, or remove it.</p>}
    </div>
  );
}

/** "Discard your changes?", in the page rather than a browser dialog, so it reads like the rest of the app. */
function DiscardConfirm({ busy, discard, keepEditing }: { busy: boolean; discard: () => void; keepEditing: () => void }) {
  const id = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <div
      className="discard-confirm"
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape") keepEditing();
      }}
    >
      <p id={`${id}-title`}>Discard your changes?</p>
      <div className="discard-actions">
        <button ref={keep} type="button" className="button button-small" onClick={keepEditing}>
          Keep editing
        </button>
        {/* Not while saving, as for Cancel: leaving waits until the save is done. */}
        <button type="button" className="button button-small button-danger" disabled={busy} onClick={discard}>
          Discard
        </button>
      </div>
    </div>
  );
}
