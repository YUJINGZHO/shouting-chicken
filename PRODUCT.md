# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML/CSS/JS for a zero-dependency first version that can later be wrapped as a PWA or app

## Users

People who want a quick, playful pressure-release interaction on a phone or desktop.

## Product Purpose

模拟现实中的尖叫鸡。用户通过按住并拖动手指感受鸡在触点处收缩，松开后听到尖叫并看到它恢复原状。

## Positioning

The core experience is spatial: press duration controls how much the chicken shrinks, while the press location controls where it buckles. It is not a static sound button.

## Operating Context

The first screen should be immediately usable without onboarding, account creation, or navigation. It should work with touch, mouse, and keyboard-accessible controls where practical.

## Capabilities and Constraints

- Press and hold on the chicken to deform it around the pointer or touch point.
- Longer holds create a stronger, smaller squeeze.
- Release triggers a squeaky sound and a spring-back animation.
- Include a visible count of completed squeezes and a mute control.
- Avoid requiring external assets or a backend for the first version.
- Exact sound design, branding, and native app packaging remain open decisions.

## Evidence on Hand

- The supplied reference image shows a tall yellow toy chicken with a narrow neck, round lower body, red mouth, collar, comb, and long red feet.
- The supplied YouTube reference (video id `fDr9G1e1Xq4`, about 13 seconds) was downloaded locally and its audio decoded and measured. It holds five cries of 0.12 s, 0.56 s, 1.06 s, 1.77 s and 3.87 s.
- Aligning that audio against the video's hand motion shows three presses, and each cry begins as the hand STOPS moving: a 0.25 s squeeze yields a 1.06 s cry, 0.50 s yields 1.77 s, 0.75 s yields 3.87 s. The scream is therefore the slow intake as the rubber springs back and drags air in, not the air being pushed out.
- Squeezing only rasps. The two quiet events measure a quarter as loud as the cries, unpitched, and centred five times higher (2.4-6.0 kHz against 1.1-1.7 kHz). The longer third squeeze produces the longer, hoarser rasp, which is the short rough sound heard before that cry.
- Measured across the cries: fundamental ~440 Hz, but the 2nd partial (880 Hz) is the loudest and the 3rd (1320 Hz) close behind, while the fundamental itself is faint and almost nothing survives above the 5th. The tone is narrow and nasal, not a bright buzz.
- Level plateaus at 70-95% of peak for the whole cry instead of decaying, then cuts off in about 50 ms when the air runs out. Pitch tracks pressure: it rises over the 35 ms attack, then sags roughly 13% as the body empties.
- Each cry opens with 40-60 ms of air hiss before the reed catches. The 0.56 s event never starts the reed at all and is pure air around 5-6 kHz, so a squeeze below the reed's threshold should only breathe.
- The longest cry breaks intermittently into a higher mode, which is why hard squeezes sound ragged rather than merely louder.
- The two shorter cries hold one clear, level note with no pitch steps. Only the longest breaks intermittently into a higher mode, so roughness belongs to deep squeezes alone.


## Product Principles

- The chicken is the interface, not decoration around a button.
- Every press should feel spatial, immediate, and reversible.
- The first interaction must be understandable without instructions.
- Keep the experience light enough to use in a few seconds.

## Accessibility & Inclusion

Support reduced motion, visible keyboard focus, readable contrast, and a non-audio visual confirmation of each squeeze.
