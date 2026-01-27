"use client"

import type { NavLinks } from "@/types";
import { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

function SidebarIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      className="transition-transform duration-300"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 12c0-3.69 0-5.534.814-6.841a4.8 4.8 0 0 1 1.105-1.243C5.08 3 6.72 3 10 3h4c3.28 0 4.919 0 6.081.916c.43.338.804.759 1.105 1.243C22 6.466 22 8.31 22 12s0 5.534-.814 6.841a4.8 4.8 0 0 1-1.105 1.243C18.92 21 17.28 21 14 21h-4c-3.28 0-4.919 0-6.081-.916a4.8 4.8 0 0 1-1.105-1.243C2 17.534 2 15.69 2 12Z" />
        <path strokeLinejoin="round" d={`M2 ${isOpen ? "8.5h20" : "14.5h20"}`} className="transition-all duration-300 ease-in-out" />
        <path strokeLinecap="round" strokeLinejoin="round" d={`${isOpen ? "M6 12h1m3 0h1" : "M6 18h4m3 0h1"}`} className="transition-all duration-300 ease-in-out" />
      </g>
    </svg>
  );
}

interface MobileNavProps {
  links: NavLinks;
  currentPath: string;
}

const isActive = (href: string, currentPath: string) => {
  if (href === "/") return currentPath === "/";
  return currentPath.startsWith(href);
};

export default function MobileNav({ links, currentPath }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen} shouldScaleBackground>
      <DrawerTrigger asChild>
        <button
          className="text-zinc-500 hover:text-zinc-100 transition-colors p-1"
          aria-label="Open menu"
        >
          <SidebarIcon isOpen={isOpen} />
        </button>
      </DrawerTrigger>
      <DrawerContent className="bg-zinc-900 border-zinc-800 max-w-md mx-auto inset-x-2 rounded-t-xl">
        <DrawerHeader>
          <DrawerTitle className="text-zinc-700 text-xs uppercase tracking-wider">
            menu
          </DrawerTitle>
        </DrawerHeader>
        <nav className="space-y-2 pb-6 px-4">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn("block transition-colors",
                isActive(link.href, currentPath)
                  ? "text-sky-500"
                  : "text-zinc-500 hover:text-zinc-100",
                link?.className
              )}
              aria-current={isActive(link.href, currentPath) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

      </DrawerContent>
    </Drawer>
  );
}
