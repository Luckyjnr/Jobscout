/**
 * The one place the web app reaches into the root project.
 *
 * src/scoring/present.ts is shared rather than duplicated: the percentage a
 * job page shows and the percentage a script prints have to be the same
 * number. Re-exported through here so that crossing the project boundary
 * happens once, in a file whose path does not change, rather than from every
 * page at a different depth.
 */
// Extensionless on purpose: this file is compiled only by the web project,
// whose resolution is "bundler". The ".js" specifier the root project needs
// for NodeNext is the one thing Turbopack will not follow out of web/.
export * from "../../src/scoring/present";
