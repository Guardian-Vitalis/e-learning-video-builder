"use client";

import type { FormEvent } from "react";
import { useState } from "react";

type Props = {
  onCreate: (input: { name: string; description?: string }) => void;
  errorMessage?: string | null;
};

export default function ProjectCreateForm({ onCreate, errorMessage }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    onCreate({
      name: trimmedName,
      description: description.trim() || undefined
    });
    setName("");
    setDescription("");
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="project-name">Name</label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Course title"
          required
        />
      </div>
      <div>
        <label htmlFor="project-description">Description (optional)</label>
        <textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Short summary"
          rows={3}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary">
          Create
        </button>
        {errorMessage && (
          <p role="alert" className="text-xs text-red-600">
            {errorMessage}
          </p>
        )}
      </div>
    </form>
  );
}
