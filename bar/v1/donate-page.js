// songaday.studio's own pages load this (the Worker adds it after the page's Donate buttons): it
// counts the page view and the Donate presses for the wording test in donate-words.js.
import { watchPage } from './donate-words.js';

watchPage();
