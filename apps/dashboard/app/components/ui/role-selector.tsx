"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  PROFESSIONAL_ROLE_CATEGORIES,
  ALL_PROFESSIONAL_ROLES,
} from "@/app/lib/roles";
import { Search, ChevronDown, Check, X, Briefcase } from "lucide-react";

interface RoleSelectorProps {
  value: string;
  customValue?: string;
  onChange: (role: string, customRole?: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function RoleSelector({
  value,
  customValue = "",
  onChange,
  required = true,
  disabled = false,
  placeholder = "Select professional role...",
  className = "",
  id,
}: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [customInput, setCustomInput] = useState(customValue);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Sync custom input
  useEffect(() => {
    setCustomInput(customValue);
  }, [customValue]);

  // Filter roles based on active category & search query
  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    let candidates = ALL_PROFESSIONAL_ROLES;

    if (activeCategory !== "All") {
      const cat = PROFESSIONAL_ROLE_CATEGORIES.find((c) => c.name === activeCategory);
      candidates = cat ? cat.roles : ALL_PROFESSIONAL_ROLES;
    }

    if (!q) return candidates;
    return candidates.filter((r) => r.toLowerCase().includes(q));
  }, [search, activeCategory]);

  const isOtherSelected = value === "Other";

  function handleSelectRole(role: string) {
    if (role === "Other") {
      onChange("Other", customInput || "");
    } else {
      onChange(role);
    }
    setIsOpen(false);
    setSearch("");
  }

  function handleCustomChange(text: string) {
    setCustomInput(text);
    onChange("Other", text);
  }

  // Display label
  const displayLabel = useMemo(() => {
    if (!value) return placeholder;
    if (value === "Other") {
      return customInput ? `Other (${customInput})` : "Other (specify below)";
    }
    return value;
  }, [value, customInput, placeholder]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors text-left ${
          isOpen
            ? "border-[#F24E4B] ring-1 ring-[#F24E4B] bg-[#0E0F14]"
            : "border-white/10 bg-[#0D0E12] hover:border-white/20 text-white"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className="flex items-center gap-2 truncate">
          <Briefcase className="size-3.5 text-white/40 shrink-0" />
          <span className={value ? "text-white font-medium truncate" : "text-white/40 truncate"}>
            {displayLabel}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 text-white/40 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-[#F24E4B]" : ""
          }`}
        />
      </button>

      {/* Custom Title Input when "Other" is chosen */}
      {isOtherSelected && (
        <div className="mt-2 animate-in fade-in duration-150">
          <input
            type="text"
            required={required}
            value={customInput}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="Type custom professional role..."
            className="w-full rounded-lg border border-[#F24E4B]/40 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
          />
        </div>
      )}

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-full min-w-[280px] sm:min-w-[340px] z-50 rounded-xl border border-white/10 bg-[#0A0B0E] p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          {/* Search Box */}
          <div className="relative mb-2.5">
            <Search className="size-3.5 text-white/40 absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search 65+ professional roles..."
              className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-7 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 text-white/40 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-2 no-scrollbar border-b border-white/5 text-[10px]">
            <button
              type="button"
              onClick={() => setActiveCategory("All")}
              className={`px-2 py-0.5 rounded font-mono whitespace-nowrap transition-colors ${
                activeCategory === "All"
                  ? "bg-[#F24E4B] text-black font-semibold"
                  : "bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              All Roles
            </button>
            {PROFESSIONAL_ROLE_CATEGORIES.map((cat) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => setActiveCategory(cat.name)}
                className={`px-2 py-0.5 rounded font-mono whitespace-nowrap transition-colors ${
                  activeCategory === cat.name
                    ? "bg-[#F24E4B] text-black font-semibold"
                    : "bg-white/5 text-white/60 hover:text-white"
                }`}
              >
                {cat.name.split(" ")[0]}
              </button>
            ))}
          </div>

          {/* Role List */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1 text-xs">
            {filteredRoles.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/40 font-mono">
                No matching role found.
                <button
                  type="button"
                  onClick={() => handleSelectRole("Other")}
                  className="block mx-auto mt-2 text-[#F24E4B] hover:underline font-sans"
                >
                  Select &quot;Other&quot; to specify
                </button>
              </div>
            ) : (
              filteredRoles.map((role) => {
                const isSelected = value === role;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleSelectRole(role)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors ${
                      isSelected
                        ? "bg-[#F24E4B]/15 text-[#F24E4B] font-semibold"
                        : "text-white/80 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{role}</span>
                    {isSelected && <Check className="size-3 text-[#F24E4B] stroke-[3]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
