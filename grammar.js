/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Tree-sitter grammar for Zutai general mode (.zt) — v0 spec.
 *
 * Known limitations:
 *  - Hyphenated field names (e.g. target-triple) are only recognised
 *    after `.` or `?.` and in record/type-record field names.
 *    In expression context (without `.`), they parse as subtraction.
 */
module.exports = grammar({
  name: 'zutai',

  extras: $ => [
    /\s+/,
    $.line_comment,
    $.doc_comment,
    $.block_comment,
  ],

  word: $ => $.identifier,

  // GLR disambiguation: multiple constructs start with `{`.
  conflicts: $ => [
    [$.record, $.type_record],
    [$.record, $.type_record, $.match_expr],
  ],

  rules: {
    source_file: $ => repeat(choice($.declaration, $._expr)),

    // ══════════════════════════════════════════════════════════════
    // Declarations
    // ══════════════════════════════════════════════════════════════

    declaration: $ => choice(
      // name := expr
      prec(2, seq(
        field('name', $.identifier),
        ':=',
        field('value', $._expr),
      )),
      // name :: <A,B>? type TypeBody
      // Uses _atom_expr (not _expr) to prevent the type body from greedily
      // consuming comparison/pipeline operators that belong to the next declaration.
      // For complex type aliases like `Int -> Int`, wrap in parens: `(Int -> Int)`.
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        'type',
        field('type', $._atom_expr),
      )),
      // name :: <A,B>? TypeExpr = expr
      // `=` terminates the type naturally (not a binary operator), so _expr is safe.
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        field('type', $._decl_type),
        '=',
        field('value', $._expr),
      )),
      // name :: <A,B>? TypeExpr { | clauses }
      // Uses _decl_type (not _expr) to prevent `{` from being consumed by application
      // instead of being recognized as the opening of func_block.
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        field('type', $._decl_type),
        field('body', $.func_block),
      )),
      // name pattern+ = expr  (simple function, no type sig)
      prec(1, seq(
        field('name', $.identifier),
        repeat1(field('param', $._pattern)),
        '=',
        field('body', $._expr),
      )),
    ),

    type_params: $ => seq('<', $.identifier, repeat(seq(',', $.identifier)), '>'),

    func_block: $ => seq('{', repeat($.clause), '}'),

    clause: $ => seq(
      '|',
      repeat1(field('param', $._pattern)),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      ';',
    ),

    guard: $ => seq('if', $._expr),

    // ══════════════════════════════════════════════════════════════
    // Expressions
    // ══════════════════════════════════════════════════════════════

    // ─── Declaration type expression ──────────────────────────────
    // Used as the type in function and typed-value declarations.
    // Excludes { } and [ ] as direct application arguments so that `{` after
    // the type is always recognised as the start of func_block (not a record
    // being applied to the type).  Complex types like `List Int` still work;
    // use `(List {a : Int})` with parens when an application with a record arg
    // is genuinely needed.

    _decl_type: $ => choice(
      $.identifier,
      $.atom,
      $.type_form,                                  // type { … } / type [ … ]
      seq('(', $._expr, ')'),                       // parenthesised escape hatch
      prec.right(10, seq($._decl_type, '->', $._decl_type)),  // function type
      prec(100, seq($._decl_type, '?')),             // optional type
      prec.left(90, seq($._decl_type, $._decl_type_arg)),     // type application
      prec.left(100, seq($._decl_type, '.', $.field_identifier)), // qualified type
    ),

    // Arguments to type application: identifiers, atoms, and parenthesised only.
    // Records and lists are excluded here; use parens if you need them.
    _decl_type_arg: $ => choice(
      $.identifier,
      $.atom,
      seq('(', $._expr, ')'),
    ),

    // _atom_expr: any expression that can be the right operand of application.
    // type_form is excluded from _apply_rhs to prevent `f type { }` from greedily
    // consuming a `type` keyword that belongs to the next declaration.
    // Use `f (type { })` with parens when passing a type value to a function.

    _atom_expr: $ => choice(
      $._apply_rhs,
      $.type_form,
    ),

    _apply_rhs: $ => choice(
      $._apply_literal,
      $.atom,
      $.identifier,
      $.record,
      $.type_record,
      $.block,
      $.list,
      $.tuple,
      $.lambda,
      $.match_expr,
      $.if_expr,
      $.import_expr,
      seq('(', $._expr, ')'),
    ),

    _expr: $ => choice(
      $._atom_expr,
      $.application,
      $.binary_op,
      $.field_access,
      $.optional_chain,
      $.postfix_opt,
    ),

    // ─── Literals ────────────────────────────────────────────────

    literal: $ => choice($.bool, $.float, $.integer, $.string),

    _apply_literal: $ => choice(
      $.bool,
      $.string,
      $._unsigned_float,
      $._unsigned_integer,
      $._negative_apply_float,
      $._negative_apply_integer,
    ),

    bool: $ => choice('true', 'false'),

    // Float before integer: "1.5" must match float, not integer then dot.
    // Also handles exponent-only form `1e9` and negative literals `-2.5e-3`.
    float: $ => token(seq(
      optional('-'),
      /[0-9]+/,
      choice(
        seq('.', /[0-9]+/, optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/))),
        seq(/[eE]/, optional(/[+-]/), /[0-9]+/),
      ),
    )),

    integer: $ => token(seq(optional('-'), /[0-9]+/)),

    _unsigned_float: $ => alias(token(seq(
      /[0-9]+/,
      choice(
        seq('.', /[0-9]+/, optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/))),
        seq(/[eE]/, optional(/[+-]/), /[0-9]+/),
      ),
    )), $.float),

    _unsigned_integer: $ => alias(token(/[0-9]+/), $.integer),

    // Application to a negative number is whitespace-sensitive:
    // `f -1` is application, while `f-1` and `f - 1` are subtraction.
    _negative_apply_float: $ => alias(token.immediate(seq(
      /[ \t\r]+/,
      '-',
      /[0-9]+/,
      choice(
        seq('.', /[0-9]+/, optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/))),
        seq(/[eE]/, optional(/[+-]/), /[0-9]+/),
      ),
    )), $.float),

    _negative_apply_integer: $ => alias(token.immediate(seq(/[ \t\r]+/, '-', /[0-9]+/)), $.integer),

    string: $ => seq(
      '"',
      repeat(choice(
        token.immediate(/[^"\\]+/),
        $.escape_seq,
      )),
      '"',
    ),

    escape_seq: $ => token.immediate(seq('\\', /[^\r\n]/)),

    // ─── Comments ─────────────────────────────────────────────────
    // Priorities ensure longest/most-specific prefix wins:
    //   block_comment (3): --[ … ]--
    //   doc_comment   (2): --| …
    //   line_comment  (1): -- …  (but NOT --[ or --|)
    // Priority ensures the longer/specific prefix wins when multiple rules
    // could start at the same `--` position:
    //   block_comment (3): --[ … ]--   (longest → wins over both others)
    //   doc_comment   (2): --| …       (longer than line_comment for same prefix)
    //   line_comment  (1): --…         (fallback; regex excludes [| so won't greedily
    //                                   consume what the longer rules should own)
    // RE2-compatible block comment (no non-greedy allowed in RE2):
    // Matches content that never forms the sequence `]--`.
    // Inside the loop: any char that isn't `]`, OR `]` not followed by `-`,
    // OR `]-` not followed by `-`.
    block_comment: $ => token(prec(3, /--\[(?:[^\]]|\](?:[^-]|-[^-]))*\]--/)),
    doc_comment:   $ => token(prec(2, /--\|[^\n]*/)),
    // `--` followed by any char that is not `[`, `|`, or newline, then rest of line.
    // When the input starts with `--|` or `--[`, the higher-priority rules win.
    line_comment:  $ => token(prec(1, /--(?:[^\[|\n][^\n]*)?/)),

    // ─── Atom literal ─────────────────────────────────────────────

    atom: $ => seq('#', token.immediate(/[A-Za-z_][A-Za-z0-9_-]*/)),

    // ─── Identifiers ──────────────────────────────────────────────

    // Standard identifier: no hyphens, used in expression/binding context.
    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,

    // Hyphenated identifier: at least one hyphen segment (e.g. target-triple).
    // Does NOT overlap with `identifier` so there is no lexer conflict.
    hyphenated_identifier: $ => /[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_][A-Za-z0-9_]*)+/,

    // Field name = identifier or hyphenated form (used in records / type records).
    _field_id: $ => choice($.identifier, $.hyphenated_identifier),

    // Field identifier: allows hyphens, used only after `.` / `?.`.
    // Context-based lexing means it is only tried in field-access position.
    field_identifier: $ => /[A-Za-z_][A-Za-z0-9_-]*/,

    // ─── Value records ────────────────────────────────────────────
    // { field = expr; … }  (value context)

    record: $ => seq('{', repeat($.record_field), '}'),

    record_field: $ => seq(
      field('name', $._field_id),
      '=',
      field('value', $._expr),
      ';',
    ),

    // ─── Type records ─────────────────────────────────────────────
    // { field : Type; … }  (type context — appears after `type`)
    // Optional fields use `field? : Type;`

    type_record: $ => seq('{', repeat($.type_field), '}'),

    type_field: $ => seq(
      field('name', $._field_id),
      optional('?'),
      ':',
      field('type', $._expr),
      ';',
    ),

    // ─── Block expressions ────────────────────────────────────────

    // Block: one or more local bindings followed by a final expression.
    block: $ => seq('{', repeat1($.local_binding), $._expr, '}'),

    local_binding: $ => seq($.identifier, ':=', $._expr, ';'),

    // ─── Lists ────────────────────────────────────────────────────

    list: $ => seq('[', repeat($.list_item), ']'),

    list_item: $ => seq($._expr, ';'),

    // ─── Tuples ───────────────────────────────────────────────────

    // Unit () or 2+ comma-separated elements.
    // Named elements use `=` in value context, `:` in type context.
    tuple: $ => choice(
      seq('(', ')'),
      seq(
        '(',
        $._tuple_elem,
        ',',
        $._tuple_elem,
        repeat(seq(',', $._tuple_elem)),
        ')',
      ),
    ),

    _tuple_elem: $ => choice(
      seq($._field_id, '=', $._expr), // value field: (field = expr, …)
      seq($._field_id, ':', $._expr), // type field:  (field : Type, …)
      $._expr,                         // positional
    ),

    // ─── Lambda ───────────────────────────────────────────────────

    // \pattern+ . body
    lambda: $ => seq('\\', repeat1($._pattern), '.', $._expr),

    // ─── Match ────────────────────────────────────────────────────

    match_expr: $ => seq(
      'match',
      field('scrutinee', $._expr),
      '{',
      repeat($.match_arm),
      '}',
    ),

    match_arm: $ => seq(
      '|',
      field('pattern', $._pattern),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      ';',
    ),

    // ─── If ───────────────────────────────────────────────────────

    if_expr: $ => seq(
      'if',
      field('condition', $._expr),
      'then',
      field('consequent', $._expr),
      'else',
      field('alternative', $._expr),
    ),

    // ─── Import ───────────────────────────────────────────────────

    import_expr: $ => seq('import', choice($.string, $.import_path)),

    // Unquoted path shorthand, e.g. config.zti
    import_path: $ => /[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/,

    // ─── Type introduction ────────────────────────────────────────
    // Restricted to _atom_expr to prevent the type body from greedily consuming
    // the next top-level declaration.  Complex type expressions like `Int -> Int`
    // must be wrapped in parens when used inside `type (...)`.

    type_form: $ => seq('type', $._atom_expr),

    // ─── Operators ────────────────────────────────────────────────

    // Precedence levels (lower number = lower precedence = binds looser):
    //  10  ->   (function type, right-assoc)
    //  20  |>   (pipeline fwd, left) / <|  (pipeline bwd, right)
    //  30  ??   (default, right)
    //  40  ||   (logical or, left)
    //  50  &&   (logical and, left)
    //  60  == != < <= > >=  (comparison, non-assoc)
    //  70  + -  (add/sub, left)
    //  80  * /  (mul/div, left)
    //  90  application  (left)
    // 100  field access / postfix ?  (highest)

    binary_op: $ => choice(
      prec.right(10,  seq($._expr, '->', $._expr)),
      prec.left(20,   seq($._expr, '|>', $._expr)),
      prec.right(20,  seq($._expr, '<|', $._expr)),
      prec.right(30,  seq($._expr, '??', $._expr)),
      prec.left(40,   seq($._expr, '||', $._expr)),
      prec.left(50,   seq($._expr, '&&', $._expr)),
      prec.left(60,   seq($._expr, choice('==', '!=', '<=', '>=', '<', '>'), $._expr)),
      prec.left(70,   seq($._expr, choice('+', '-'), $._expr)),
      prec.left(80,   seq($._expr, choice('*', '/'), $._expr)),
    ),

    // f x  (function application, left-assoc)
    // Right side uses _apply_rhs (excludes type_form) to prevent `f type ...`
    // from greedily consuming a `type` keyword that starts the next declaration.
    application: $ => prec.left(90, seq($._expr, $._apply_rhs)),

    // T?  (postfix optional type or optional value)
    postfix_opt: $ => prec(100, seq($._expr, '?')),

    // expr.field and expr?.field — field_identifier allows hyphens here
    field_access: $ => prec.left(100, seq($._expr, '.', $.field_identifier)),
    optional_chain: $ => prec.left(100, seq($._expr, '?.', $.field_identifier)),

    // ══════════════════════════════════════════════════════════════
    // Patterns
    // ══════════════════════════════════════════════════════════════

    _pattern: $ => choice(
      $.literal,
      $.atom,
      $.identifier,
      $.wildcard,
      $.tuple_pat,
      $.record_pat,
    ),

    // `_` alone as wildcard; prec(1) makes it win over identifier for `_`
    wildcard: $ => token(prec(1, '_')),

    tuple_pat: $ => choice(
      seq('(', ')'),
      seq(
        '(',
        $._pat_elem,
        ',',
        $._pat_elem,
        repeat(seq(',', $._pat_elem)),
        ')',
      ),
    ),

    _pat_elem: $ => choice(
      seq($._field_id, '=', $._pattern), // named: field = pattern
      $._pattern,                         // positional
    ),

    record_pat: $ => seq('{', repeat($.record_pat_field), '}'),

    record_pat_field: $ => seq($._field_id, '=', $._pattern, ';'),
  },
});
