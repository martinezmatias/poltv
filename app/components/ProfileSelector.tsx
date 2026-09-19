"use client";

import { useState } from "react";
import { DEFAULT_VIEWER_PROFILE_ID, VIEWER_PROFILES } from "../../config/profiles";

export function ProfileSelector() {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(DEFAULT_VIEWER_PROFILE_ID);
  const selectedProfile = VIEWER_PROFILES.find((profile) => profile.id === selectedId) ?? VIEWER_PROFILES[0];

  return (
    <div className="profile-selector">
      <button
        type="button"
        className="profile-trigger"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="profile-avatar" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedProfile.image} alt="" />
        </span>
        <span>
          <span className="eyebrow">Watching as</span>
          <strong>{selectedProfile.name}</strong>
        </span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="profile-menu" role="menu">
          {VIEWER_PROFILES.map((profile) => (
            <button
              type="button"
              role="menuitem"
              className={profile.id === selectedId ? "profile-option selected" : "profile-option"}
              key={profile.id}
              onClick={() => {
                setSelectedId(profile.id);
                setOpen(false);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.image} alt="" />
              <span>
                <strong>{profile.name}</strong>
                <small>{profile.role}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
