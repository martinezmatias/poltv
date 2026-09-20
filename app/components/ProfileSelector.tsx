"use client";

import { useState } from "react";
import Link from "next/link";
import { VIEWER_PROFILES } from "../../config/profiles";

type ProfileSelectorProps = {
  selectedId: string;
  onSelect: (profileId: string) => void;
};

export function ProfileSelector({ selectedId, onSelect }: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectedProfile = VIEWER_PROFILES.find((profile) => profile.id === selectedId) ?? VIEWER_PROFILES[0];

  return (
    <div className="profile-selector">
      <div className="profile-trigger">
        <Link className="profile-avatar-link" href={`/profile/${selectedId}`} aria-label={`Open ${selectedProfile.name}'s profile`}>
          <span className="profile-avatar" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selectedProfile.image} alt="" />
          </span>
        </Link>
        <button
          type="button"
          className="profile-name-trigger"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            <span className="eyebrow">Watching as</span>
            <strong>{selectedProfile.name}</strong>
          </span>
          <span className="chevron" aria-hidden="true">⌄</span>
        </button>
      </div>
      {open ? (
        <div className="profile-menu" role="menu">
          {VIEWER_PROFILES.map((profile) => (
            <button
              type="button"
              role="menuitem"
              className={profile.id === selectedId ? "profile-option selected" : "profile-option"}
              key={profile.id}
              onClick={() => {
                onSelect(profile.id);
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
