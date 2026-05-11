# LLM Evaluation Frameworks

Evaluating LLMs is challenging due to their open-ended capabilities. This guide covers frameworks, metrics, and best practices.

## Why LLM Evaluation is Hard

- **Open-ended outputs** - No single "correct" answer
- **Subjectivity** - Quality is often in the eye of the beholder
- **Test contamination** - Models may have seen benchmark data
- **Capability vs safety** - Balance performance with responsibility

## Evaluation Dimensions

```
LLM Evaluation
├── Capability
│   ├── Knowledge & Factual Accuracy
│   ├── Reasoning (logical, math, common sense)
│   ├── Language Understanding
│   ├── Generation Quality
│   └── Task Completion
├── Safety & Alignment
│   ├── Harmlessness
│   ├── Helpfulness
│   └── Honesty (truthfulness)
└── Practical
    ├── Latency
    ├── Cost
    └── Robustness
```

## Benchmarks by Category

### 1. General Knowledge

| Benchmark | Description | Metric |
|-----------|-------------|--------|
| MMLU | 57 subjects, mass multitask | Accuracy |
| TriviaQA | Fact Q&A | EM, F1 |
| NaturalQuestions | Google Q&A | Accuracy |
| HellaSwag | Commonsense completion | Accuracy |
| TruthfulQA | Truthful Q&A | Accuracy |

### 2. Reasoning

```python
# GSM8K - Grade School Math
def evaluate_math(model, problems):
    correct = 0
    for problem in problems:
        answer = model.generate(problem)
        if extract_number(answer) == extract_number(problem.solution):
            correct += 1
    return correct / len(problems)

# MATH - Competition math
math_benchmark = load_dataset("hendrycks/math")

# ARC - Abstract reasoning
arc_benchmark = load_dataset("allenai/ai2_arc")
```

### 3. Code Generation

| Benchmark | Description |
|-----------|-------------|
| HumanEval | 164 Python problems |
| MBPP | 974 Python problems |
| CodexEval | Python, Java, JS, Go, Rust |
| APPS | Coding interview style |

```python
from human_eval import evaluate_model

def evaluate_code_generation(model):
    results = evaluate_model(model, k=[1, 10, 100])
    return {
        "pass@1": results["pass_at_1"],
        "pass@10": results["pass_at_10"],
        "pass@100": results["pass_at_100"],
    }
```

### 4. Instruction Following

```python
# IFEval - Instruction following
def ifeval_evaluation(model):
    prompts = load_ifeval_prompts()
    results = []
    
    for prompt in prompts:
        response = model.generate(prompt)
        
        # Check if response follows the constraints
        constraints = prompt.constraints
        violations = check_constraints(response, constraints)
        results.append(len(violations) == 0)
    
    return sum(results) / len(results)
```

## LLM-as-Judge

Using a stronger LLM to evaluate responses:

```python
class LLMJudge:
    def __init__(self, judge_model):
        self.judge = judge_model
    
    def evaluate_response(self, prompt, response, rubric):
        evaluation_prompt = f"""
        Prompt: {prompt}
        
        Response to evaluate: {response}
        
        Evaluation Rubric:
        {rubric}
        
        Provide a score from 1-10 and brief justification.
        """
        
        result = self.judge.generate(evaluation_prompt)
        return self.parse_evaluation(result)
    
    def compare_responses(self, prompt, response_a, response_b):
        comparison_prompt = f"""
        Compare these two responses to the prompt:
        
        Prompt: {prompt}
        
        Response A: {response_a}
        
        Response B: {response_b}
        
        Which response is better? Justify briefly.
        """
        return self.judge.generate(comparison_prompt)
```

### Win Rate Comparison

```python
def compute_win_rate(model_a, model_b, prompts):
    wins = 0
    ties = 0
    judge = LLMJudge("gpt-4")
    
    for prompt in prompts:
        response_a = model_a.generate(prompt)
        response_b = model_b.generate(prompt)
        
        result = judge.compare_responses(prompt, response_a, response_b)
        
        if "A is better" in result:
            wins += 1
        elif "B is better" in result:
            wins -= 1
        else:
            ties += 0.5
    
    return (wins + ties) / len(prompts)
```

## Building Custom Evaluations

### 1. Define Criteria

```python
EVALUATION_CRITERIA = {
    "relevance": {
        "weight": 0.3,
        "description": "Addresses the user's question",
        "levels": ["Off-topic", "Partial", "Relevant", "Perfect"],
    },
    "accuracy": {
        "weight": 0.3,
        "description": "Factual correctness",
        "levels": ["Mostly wrong", "Some errors", "Mostly correct", "Accurate"],
    },
    "completeness": {
        "weight": 0.2,
        "description": "Covers all aspects",
        "levels": ["Incomplete", "Partial", "Complete", "Comprehensive"],
    },
    "clarity": {
        "weight": 0.2,
        "description": "Clear and well-structured",
        "levels": ["Confusing", "Somewhat clear", "Clear", "Excellent"],
    },
}
```

### 2. Create Test Suites

```python
class TestSuite:
    def __init__(self, name, tests):
        self.name = name
        self.tests = tests
    
    def run(self, model):
        results = []
        for test in self.tests:
            output = model.generate(test.input)
            score = test.evaluate(output, test.expected)
            results.append({
                "test": test.name,
                "passed": score >= test.threshold,
                "score": score,
                "output": output,
            })
        return results
    
    def summary(self, results):
        return {
            "total": len(results),
            "passed": sum(1 for r in results if r["passed"]),
            "avg_score": np.mean([r["score"] for r in results]),
        }
```

### 3. Automated Assertions

```python
class AssertionEvaluator:
    def __init__(self):
        self.assertions = [
            StringAssertion("must contain keyword"),
            LengthAssertion(min=10, max=500),
            JsonValidAssertion(),
            NoRefusalAssertion(),
            PIIRedactionAssertion(),
        ]
    
    def evaluate(self, output):
        results = []
        for assertion in self.assertions:
            passed, message = assertion.check(output)
            results.append({
                "assertion": assertion.name,
                "passed": passed,
                "message": message,
            })
        return results
```

## Evaluation Pipelines

```python
class EvaluationPipeline:
    def __init__(self, model, benchmarks, evaluators):
        self.model = model
        self.benchmarks = benchmarks
        self.evaluators = evaluators
    
    def run_full_evaluation(self):
        results = {}
        
        # Run benchmarks
        for name, benchmark in self.benchmarks.items():
            results[name] = benchmark.evaluate(self.model)
        
        # Run custom evaluators
        for name, evaluator in self.evaluators.items():
            results[name] = evaluator.evaluate(self.model)
        
        return results
    
    def generate_report(self, results):
        report = "# Evaluation Report\n\n"
        
        for category, metrics in results.items():
            report += f"## {category}\n"
            for metric, value in metrics.items():
                report += f"- {metric}: {value}\n"
            report += "\n"
        
        return report
```

## Continuous Evaluation

```python
class ContinuousEvaluator:
    def __init__(self, production_logger, evaluation_suite):
        self.logger = production_logger
        self.suite = evaluation_suite
    
    def evaluate_production_outputs(self, model):
        # Sample from production
        samples = self.logger.sample_recent(n=100)
        
        results = []
        for sample in samples:
            output = sample.response
            score = self.suite.evaluate_single(output, sample.context)
            results.append(score)
        
        return {
            "mean_score": np.mean(results),
            "p95_score": np.percentile(results, 95),
            "regression_detected": np.mean(results) < self.baseline,
        }
```

## Summary

- Evaluation requires multiple dimensions (capability, safety, practical)
- Use established benchmarks as baselines
- LLM-as-judge enables flexible evaluation
- Build custom tests for domain-specific needs
- Continuous evaluation catches regressions in production