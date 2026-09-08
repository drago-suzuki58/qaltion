/*
 * Qaltion libqalculate bridge.
 *
 * This file is intentionally small. Expression parsing and evaluation stay
 * inside libqalculate; Qaltion only converts the result into plain values.
 */
#include <emscripten/bind.h>
#include <libqalculate/Calculator.h>
#include <libqalculate/Function.h>
#include <libqalculate/Prefix.h>
#include <libqalculate/Unit.h>
#include <libqalculate/Variable.h>

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

using namespace emscripten;

std::string jsonString(const std::string& value) {
  const char hex[] = "0123456789abcdef";
  std::string escaped = "\"";
  for (const unsigned char character : value) {
    if (character == '\\') escaped += "\\\\";
    else if (character == '"') escaped += "\\\"";
    else if (character == '\b') escaped += "\\b";
    else if (character == '\f') escaped += "\\f";
    else if (character == '\n') escaped += "\\n";
    else if (character == '\r') escaped += "\\r";
    else if (character == '\t') escaped += "\\t";
    else if (character < 0x20) {
      escaped += "\\u00";
      escaped += hex[character >> 4];
      escaped += hex[character & 0x0f];
    } else {
      escaped += static_cast<char>(character);
    }
  }
  escaped += "\"";
  return escaped;
}

void appendName(std::string& output, bool& first, const std::string& name) {
  if (name.empty()) return;
  if (!first) output += ",";
  output += jsonString(name);
  first = false;
}

template <typename Getter>
void appendExpressionCategory(std::string& output, Getter getter) {
  output += "[";
  bool first = true;
  for (size_t itemIndex = 0;; itemIndex++) {
    const ExpressionItem* item = getter(itemIndex);
    if (!item) break;
    if (!item->isActive()) continue;
    for (size_t nameIndex = 1;; nameIndex++) {
      const ExpressionName& name = item->getName(nameIndex);
      if (name.name.empty()) break;
      if (!name.completion_only) appendName(output, first, name.name);
    }
  }
  output += "]";
}

void appendUnitCategory(std::string& output, Calculator& calculator, bool currencies) {
  output += "[";
  bool first = true;
  for (size_t itemIndex = 0;; itemIndex++) {
    Unit* item = calculator.getUnit(itemIndex);
    if (!item) break;
    if (!item->isActive() || item->isCurrency() != currencies) continue;
    for (size_t nameIndex = 1;; nameIndex++) {
      const ExpressionName& name = item->getName(nameIndex);
      if (name.name.empty()) break;
      if (!name.completion_only) appendName(output, first, name.name);
    }
  }
  output += "]";
}

void appendPrefixCategory(std::string& output, Calculator& calculator) {
  output += "[";
  bool first = true;
  for (size_t itemIndex = 0;; itemIndex++) {
    Prefix* item = calculator.getPrefix(itemIndex);
    if (!item) break;
    for (size_t nameIndex = 1;; nameIndex++) {
      const ExpressionName& name = item->getName(nameIndex);
      if (name.name.empty()) break;
      if (!name.completion_only) appendName(output, first, name.name);
    }
  }
  output += "]";
}

size_t assignmentSeparator(const std::string& expression) {
  size_t index = 0;
  while (index < expression.size() && std::isspace(static_cast<unsigned char>(expression[index]))) index++;
  if (index == expression.size() || (!std::isalpha(static_cast<unsigned char>(expression[index])) && expression[index] != '_')) return std::string::npos;
  index++;
  while (index < expression.size() && (std::isalnum(static_cast<unsigned char>(expression[index])) || expression[index] == '_')) index++;
  while (index < expression.size() && std::isspace(static_cast<unsigned char>(expression[index]))) index++;
  if (index >= expression.size() || expression[index] != '=' ||
      (index + 1 < expression.size() && expression[index + 1] == '=')) return std::string::npos;
  return index;
}

std::string assignmentValue(const std::string& expression) {
  const size_t separator = assignmentSeparator(expression);
  return separator == std::string::npos ? expression : expression.substr(separator + 1);
}

std::string assignmentName(const std::string& expression) {
  const size_t separator = assignmentSeparator(expression);
  if (separator == std::string::npos) return "";
  const size_t start = expression.find_first_not_of(" \t\n\r\f\v");
  const size_t end = expression.find_last_not_of(" \t\n\r\f\v", separator - 1);
  return expression.substr(start, end - start + 1);
}

std::string expressionBeforeConversion(const std::string& expression) {
  const size_t conversion = expression.find(" to ");
  return conversion == std::string::npos ? expression : expression.substr(0, conversion);
}

std::string withoutSpaces(const std::string& value) {
  std::string compact;
  compact.reserve(value.size());
  for (const char character : value) {
    if (!std::isspace(static_cast<unsigned char>(character))) compact += character;
  }
  return compact;
}

struct EvaluationResult {
  bool ok;
  std::string result;
  std::string error;
};

class QaltionEngine {
  public:
  QaltionEngine() : calculator(true) {
    calculator.loadExchangeRates();
    calculator.loadGlobalDefinitions();
  }

  EvaluationResult evaluate(const std::string& expression) {
    calculator.clearMessages();
    ParseOptions parseOptions = default_parse_options;
    parseOptions.limit_implicit_multiplication = true;
    const std::string parsedExpression = expressionBeforeConversion(assignmentValue(expression));
    if (withoutSpaces(parsedExpression).empty()) {
      return {false, "", "Invalid expression"};
    }
    const MathStructure parsed = calculator.parse(parsedExpression, parseOptions);
    if (parsed.containsType(STRUCT_SYMBOLIC, true)) {
      return {false, "", "Undefined symbol"};
    }

    EvaluationOptions options = default_user_evaluation_options;
    options.parse_options.unknowns_enabled = false;
    options.parse_options.limit_implicit_multiplication = true;
    const std::string result = calculator.calculateAndPrint(expression, 2000, options);
    if (!result.empty()) {
      if (parsed.isAddition() && parsed.containsType(STRUCT_UNIT, true) && withoutSpaces(expression) == withoutSpaces(result)) {
        return {false, "", "Incompatible units"};
      }
      const std::string name = assignmentName(expression);
      if (!name.empty() && std::find(contextVariables.begin(), contextVariables.end(), name) == contextVariables.end()) {
        contextVariables.push_back(name);
      }
      return {true, result, ""};
    }

    std::string error = "Calculation failed";
    if (auto* message = calculator.message()) {
      error = message->message();
    }
    return {false, "", error};
  }

  void resetContext() {
    for (const std::string& name : contextVariables) {
      Variable* variable = calculator.getActiveVariable(name, true);
      if (variable && variable->isLocal() && !variable->isBuiltin()) variable->destroy();
    }
    contextVariables.clear();
    calculator.clearMessages();
  }

  std::string getSymbolRegistry() {
    std::string registry = "{\"functions\":";
    appendExpressionCategory(registry, [this](size_t index) { return calculator.getFunction(index); });
    registry += ",\"variables\":";
    appendExpressionCategory(registry, [this](size_t index) { return calculator.getVariable(index); });
    registry += ",\"units\":";
    appendUnitCategory(registry, calculator, false);
    registry += ",\"currencies\":";
    appendUnitCategory(registry, calculator, true);
    registry += ",\"prefixes\":";
    appendPrefixCategory(registry, calculator);
    registry += "}";
    return registry;
  }

  private:
  Calculator calculator;
  std::vector<std::string> contextVariables;
};

EMSCRIPTEN_BINDINGS(qaltion_bridge) {
  value_object<EvaluationResult>("EvaluationResult")
      .field("ok", &EvaluationResult::ok)
      .field("result", &EvaluationResult::result)
      .field("error", &EvaluationResult::error);

  class_<QaltionEngine>("QaltionEngine")
      .constructor<>()
      .function("evaluate", &QaltionEngine::evaluate)
      .function("resetContext", &QaltionEngine::resetContext)
      .function("getSymbolRegistry", &QaltionEngine::getSymbolRegistry);
}
