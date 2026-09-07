/*
 * Qaltion libqalculate bridge.
 *
 * This file is intentionally small. Expression parsing and evaluation stay
 * inside libqalculate; Qaltion only converts the result into plain values.
 */
#include <emscripten/bind.h>
#include <libqalculate/Calculator.h>

#include <cctype>
#include <string>

using namespace emscripten;

std::string assignmentValue(const std::string& expression) {
  size_t index = 0;
  while (index < expression.size() && std::isspace(static_cast<unsigned char>(expression[index]))) index++;
  if (index == expression.size() || (!std::isalpha(static_cast<unsigned char>(expression[index])) && expression[index] != '_')) return expression;
  index++;
  while (index < expression.size() && (std::isalnum(static_cast<unsigned char>(expression[index])) || expression[index] == '_')) index++;
  while (index < expression.size() && std::isspace(static_cast<unsigned char>(expression[index]))) index++;
  if (index >= expression.size() || expression[index] != '=' ||
      (index + 1 < expression.size() && expression[index + 1] == '=')) return expression;
  return expression.substr(index + 1);
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
    const MathStructure parsed = calculator.parse(expressionBeforeConversion(assignmentValue(expression)), parseOptions);
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
      return {true, result, ""};
    }

    std::string error = "Calculation failed";
    if (auto* message = calculator.message()) {
      error = message->message();
    }
    return {false, "", error};
  }

  void resetContext() {
    calculator.reset();
    calculator.loadExchangeRates();
    calculator.loadGlobalDefinitions();
  }

  private:
  Calculator calculator;
};

EMSCRIPTEN_BINDINGS(qaltion_bridge) {
  value_object<EvaluationResult>("EvaluationResult")
      .field("ok", &EvaluationResult::ok)
      .field("result", &EvaluationResult::result)
      .field("error", &EvaluationResult::error);

  class_<QaltionEngine>("QaltionEngine")
      .constructor<>()
      .function("evaluate", &QaltionEngine::evaluate)
      .function("resetContext", &QaltionEngine::resetContext);
}
